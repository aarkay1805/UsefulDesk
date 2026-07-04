"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import type { Membership } from "@/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RenewalActionLists } from "@/components/members/renewal-action-lists";
import { MembersTable } from "@/components/members/members-table";
import { MemberForm } from "@/components/members/member-form";
import { MemberDetailView } from "@/components/members/member-detail-view";
import { CheckInView } from "@/components/members/check-in-view";
import { PaymentSummaryTiles } from "@/components/members/payment-summary-tiles";
import { PaymentDueBuckets } from "@/components/members/payment-due-buckets";
import { PaymentsLedger } from "@/components/members/payments-ledger";
import { useReminderReadiness } from "@/components/members/send-reminder-button";

type View = "renewals" | "payments" | "all" | "checkin";

const VIEW_LABEL: Record<View, string> = {
  renewals: "Renewals",
  payments: "Payments",
  all: "All members",
  checkin: "Check-in",
};

export default function MembersPage() {
  const { canSendMessages } = useAuth();
  const readiness = useReminderReadiness();

  const [view, setView] = useState<View>("renewals");
  const [reloadKey, setReloadKey] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const reload = () => setReloadKey((k) => k + 1);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openDetail(id: string) {
    setDetailId(id);
    setDetailOpen(true);
  }

  function editFromDetail(membership: Membership) {
    setDetailOpen(false);
    setEditing(membership);
    setFormOpen(true);
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track memberships, renewals, and payments — and nudge members on WhatsApp.
          </p>
        </div>
        {canSendMessages && (
          <Button onClick={openAdd} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" /> Add member
          </Button>
        )}
      </div>

      {/* View toggle */}
      <div className="mt-5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {(["renewals", "payments", "all", "checkin"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              view === v
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {view === "renewals" ? (
          <RenewalActionLists
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKey}
          />
        ) : view === "payments" ? (
          <div className="space-y-6">
            <PaymentSummaryTiles reloadKey={reloadKey} />
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-foreground">Payment due</h2>
              <PaymentDueBuckets
                readiness={readiness}
                onSelect={openDetail}
                reloadKey={reloadKey}
                onChanged={reload}
              />
            </div>
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-foreground">Recent payments</h2>
              <PaymentsLedger reloadKey={reloadKey} />
            </div>
          </div>
        ) : view === "all" ? (
          <MembersTable
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKey}
          />
        ) : (
          <CheckInView reloadKey={reloadKey} onCheckedIn={reload} />
        )}
      </div>

      <MemberForm
        open={formOpen}
        onOpenChange={setFormOpen}
        member={editing}
        onSaved={reload}
        onViewExisting={(contactId) => {
          // The dedupe path hands back a contact id; the member's row is
          // keyed by membership id, so just refresh the list — the member
          // now shows there. (Opening their exact detail would need a
          // contact→membership lookup we skip for MVP.)
          void contactId;
          reload();
        }}
      />

      <MemberDetailView
        membershipId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        readiness={readiness}
        onChanged={reload}
        onEdit={editFromDetail}
      />
    </div>
  );
}
