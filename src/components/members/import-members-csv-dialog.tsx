"use client";

// ImportMembersCsvDialog — bring an Excel/CSV member register into the
// gym domain: Upload → Map columns → Confirm. Deliberately a separate,
// lightweight dialog rather than a `variant="members"` on the shared
// ImportWizard (which is contact-centric and already carries two
// variants) — reuse happens at the library layer instead: parseCsvRaw
// (contacts/field-mapping), normalizeKey/isUniqueViolation (dedupe),
// detectDateOrder (leads/import-coerce), and the pure member engine in
// lib/memberships/import-commit (mapping targets, DMY date parsing, plan
// resolution, membership payload building — all unit-tested).
//
// Commit path per row: find-or-create the contact by normalized phone
// (received_via 'import'), then insert the membership individually —
// UNIQUE(account_id, contact_id) means a batch insert dies atomically on
// one already-member row, so per-row inserts + isUniqueViolation =
// "skipped", never a sunk batch. The toast reports the full tally.

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { importDateOrder } from "@/lib/locale/config";
import { parseCsvRaw, type RawCsv } from "@/lib/contacts/field-mapping";
import { isUniqueViolation, normalizeKey } from "@/lib/contacts/dedupe";
import { detectDateOrder, type DateOrder } from "@/lib/leads/import-coerce";
import {
  applyMemberMapping,
  autoMapMemberColumns,
  buildMembershipRow,
  MEMBER_IGNORE_KEY,
  MEMBER_TARGETS,
  MEMBER_TEMPLATE_CSV,
} from "@/lib/memberships/import-commit";
import { downloadCsv } from "@/lib/csv/export";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMembershipPlans } from "./use-membership-plans";

type Step = "upload" | "map" | "confirm";

interface ImportMembersCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ImportMembersCsvDialog({
  open,
  onOpenChange,
  onSaved,
}: ImportMembersCsvDialogProps) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const { locale, fmt } = useLocale();
  // Ambiguous numeric dates parse with the account's order (055).
  const accountDateOrder = importDateOrder(locale);
  const { plans } = useMembershipPlans(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [csv, setCsv] = useState<RawCsv | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [dateOrder, setDateOrder] = useState<DateOrder>(accountDateOrder);
  const [importing, setImporting] = useState(false);

  // Fresh wizard each open (render-time reset per the repo lint rule).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStep("upload");
      setCsv(null);
      setMapping([]);
      setDateOrder(accountDateOrder);
      setImporting(false);
    }
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvRaw(String(reader.result ?? ""));
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        toast.error("Couldn't read any rows from that file.");
        return;
      }
      setCsv(parsed);
      const auto = autoMapMemberColumns(parsed.headers);
      setMapping(auto);
      // India-first: DMY unless the date columns prove month-first.
      const dateCols = auto
        .map((key, i) => (key === "start_date" || key === "end_date" ? i : -1))
        .filter((i) => i >= 0);
      const samples = dateCols.flatMap((i) =>
        parsed.rows.slice(0, 50).map((r) => r[i] ?? "")
      );
      const detected = detectDateOrder(samples);
      setDateOrder(detected === "ambiguous" ? accountDateOrder : detected);
      setStep("map");
    };
    reader.readAsText(file);
  }

  const phoneMapped = mapping.includes("phone");
  const planMapped = mapping.includes("plan");
  const hasDateColumn =
    mapping.includes("start_date") || mapping.includes("end_date");

  // Everything the Confirm step reports, derived once per mapping change.
  const preview = useMemo(() => {
    if (!csv) return null;
    const { rows, skippedNoPhone, skippedDuplicate } = applyMemberMapping(
      csv.rows,
      mapping
    );
    const today = fmt.today();
    const ready: {
      row: (typeof rows)[number];
      membership: NonNullable<
        ReturnType<typeof buildMembershipRow>["membership"]
      >;
    }[] = [];
    let unknownPlan = 0;
    let badRow = 0;
    for (const row of rows) {
      const { membership, errors } = buildMembershipRow(
        row,
        plans,
        dateOrder,
        today
      );
      if (membership) ready.push({ row, membership });
      else if (errors.includes("unknown-plan")) unknownPlan++;
      else badRow++;
    }
    return { ready, skippedNoPhone, skippedDuplicate, unknownPlan, badRow };
  }, [csv, mapping, plans, dateOrder, fmt]);

  async function handleImport() {
    if (!accountId || !user || !preview || preview.ready.length === 0) return;
    setImporting(true);

    // One read of existing contacts → normalized-phone map, and one of
    // existing member contact_ids — so the loop below is insert-only.
    const [{ data: contacts }, { data: memberships }] = await Promise.all([
      supabase.from("contacts").select("id, phone"),
      supabase.from("memberships").select("contact_id"),
    ]);
    const contactIdByPhone = new Map(
      ((contacts as { id: string; phone: string }[]) ?? []).map((c) => [
        normalizeKey(c.phone),
        c.id,
      ])
    );
    const alreadyMember = new Set(
      ((memberships as { contact_id: string }[]) ?? []).map((m) => m.contact_id)
    );

    let imported = 0;
    let attached = 0;
    let skippedMember = 0;
    let failed = 0;

    for (const { row, membership } of preview.ready) {
      const key = normalizeKey(row.phone);
      let contactId = contactIdByPhone.get(key) ?? null;

      if (contactId && alreadyMember.has(contactId)) {
        skippedMember++;
        continue;
      }

      const existedBefore = !!contactId;
      if (!contactId) {
        const { data, error } = await supabase
          .from("contacts")
          .insert({
            user_id: user.id,
            account_id: accountId,
            name: row.name || null,
            phone: row.phone,
            email: row.email || null,
            received_via: "import" as const,
          })
          .select("id")
          .single();
        if (error || !data?.id) {
          failed++;
          continue;
        }
        contactId = data.id;
        contactIdByPhone.set(key, data.id);
      }
      if (!contactId) {
        failed++;
        continue;
      }

      const { error: mErr } = await supabase.from("memberships").insert({
        account_id: accountId,
        contact_id: contactId,
        user_id: user.id,
        status: "active",
        is_trial: false,
        ...membership,
      });
      if (mErr) {
        // UNIQUE(account_id, contact_id) — already a member (race or a
        // contact-map miss). A skip, not a failure.
        if (isUniqueViolation(mErr)) skippedMember++;
        else failed++;
        continue;
      }
      alreadyMember.add(contactId);
      if (existedBefore) attached++;
      else imported++;
    }

    setImporting(false);

    const parts: string[] = [];
    if (imported) parts.push(`${imported} new member${imported === 1 ? "" : "s"} imported`);
    if (attached) parts.push(`${attached} attached to existing contacts`);
    if (skippedMember) parts.push(`${skippedMember} already members`);
    if (preview.unknownPlan) parts.push(`${preview.unknownPlan} unknown plan`);
    if (preview.badRow) parts.push(`${preview.badRow} unreadable`);
    if (preview.skippedDuplicate) parts.push(`${preview.skippedDuplicate} in-file duplicates`);
    if (preview.skippedNoPhone) parts.push(`${preview.skippedNoPhone} without phone`);
    if (failed) parts.push(`${failed} failed`);
    (imported + attached === 0 && failed
      ? toast.error
      : toast.success)(parts.join(" · ") || "Nothing to import");

    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import members from CSV</DialogTitle>
          <DialogDescription>
            {step === "upload" &&
              "Upload your member register — an Excel export saved as CSV works."}
            {step === "map" &&
              "Match your file's columns to member fields. Phone and Plan are required."}
            {step === "confirm" && "Review what will be imported."}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground hover:bg-muted">
              <Upload className="size-6" />
              Click to choose a .csv file
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => downloadCsv("members-template.csv", MEMBER_TEMPLATE_CSV)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Download className="size-3.5" /> Download a sample template
            </button>
          </div>
        )}

        {step === "map" && csv && (
          <div className="space-y-3">
            <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              {csv.headers.map((header, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {header || `Column ${i + 1}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      e.g. {csv.rows[0]?.[i] || "—"}
                    </p>
                  </div>
                  <Select
                    value={mapping[i] ?? MEMBER_IGNORE_KEY}
                    onValueChange={(v) =>
                      setMapping((prev) => {
                        const key = v ?? MEMBER_IGNORE_KEY;
                        const next = [...prev];
                        // One column per target — unset any other column
                        // that held this key.
                        if (key !== MEMBER_IGNORE_KEY) {
                          for (let j = 0; j < next.length; j++) {
                            if (j !== i && next[j] === key) next[j] = MEMBER_IGNORE_KEY;
                          }
                        }
                        next[i] = key;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MEMBER_IGNORE_KEY}>Don&apos;t import</SelectItem>
                      {MEMBER_TARGETS.map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {hasDateColumn && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Date format in your file
                </span>
                <div className="flex gap-1">
                  {(["DMY", "MDY"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setDateOrder(o)}
                      className={
                        dateOrder === o
                          ? "rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground"
                          : "rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
                      }
                    >
                      {o === "DMY" ? "DD/MM/YYYY" : "MM/DD/YYYY"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!phoneMapped && (
              <p className="text-xs text-destructive">
                Map a column to Phone — it identifies each member.
              </p>
            )}
            {!planMapped && (
              <p className="text-xs text-amber-foreground">
                No Plan column mapped — every row needs a plan name matching
                one of your membership plans.
              </p>
            )}
          </div>
        )}

        {step === "confirm" && preview && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <FileSpreadsheet className="size-4 text-muted-foreground" />
              <span className="font-medium text-foreground">
                {preview.ready.length} member
                {preview.ready.length === 1 ? "" : "s"} ready to import
              </span>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {preview.unknownPlan > 0 && (
                <li>
                  {preview.unknownPlan} skipped — plan name doesn&apos;t match any
                  membership plan (add the plan in Settings first).
                </li>
              )}
              {preview.badRow > 0 && (
                <li>{preview.badRow} skipped — unreadable date or fee.</li>
              )}
              {preview.skippedDuplicate > 0 && (
                <li>{preview.skippedDuplicate} in-file duplicate phone numbers.</li>
              )}
              {preview.skippedNoPhone > 0 && (
                <li>{preview.skippedNoPhone} rows without a phone number.</li>
              )}
              <li>
                Rows whose phone is already a member are skipped, never
                double-created.
              </li>
            </ul>
          </div>
        )}

        <DialogFooter>
          {step !== "upload" && (
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => setStep(step === "confirm" ? "map" : "upload")}
            >
              Back
            </Button>
          )}
          {step === "map" && (
            <Button
              type="button"
              disabled={!phoneMapped}
              onClick={() => setStep("confirm")}
            >
              Continue
            </Button>
          )}
          {step === "confirm" && (
            <Button
              type="button"
              onClick={handleImport}
              disabled={importing || !preview || preview.ready.length === 0}
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Import {preview?.ready.length ?? 0} member
              {(preview?.ready.length ?? 0) === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
