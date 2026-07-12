"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { GENDER_OPTIONS } from "@/lib/leads/attributes";
import type { Contact } from "@/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MemberPersonalInfoProps {
  contact: Contact;
  canEdit: boolean;
  onSaved: () => void;
}

/** Editable fields, seeded from the contact. `name` stays a single
 *  field (contacts.name is the product-wide identity — no first/last
 *  split). */
type Draft = {
  name: string;
  nickname: string;
  email: string;
  phone: string;
  gender: string;
  date_of_birth: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

function toDraft(c: Contact): Draft {
  return {
    name: c.name ?? "",
    nickname: c.nickname ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    gender: c.gender ?? "",
    date_of_birth: c.date_of_birth ?? "",
    address_line1: c.address_line1 ?? "",
    address_line2: c.address_line2 ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    postal_code: c.postal_code ?? "",
    country: c.country ?? "",
  };
}

/** One labelled input in the personal-info grid. */
function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {type === "date" ? (
        <DatePicker
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
        />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

/**
 * Member Personal Information — reuses the existing contact identity
 * columns (name/phone/email/gender) and the migration-056 profile
 * columns (nickname, birthday, postal address). Editable for
 * canSendMessages; a single Save writes the whole form.
 */
export function MemberPersonalInfo({
  contact,
  canEdit,
  onSaved,
}: MemberPersonalInfoProps) {
  const supabase = createClient();
  const initial = useMemo(() => toDraft(contact), [contact]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);

  const dirty = useMemo(
    () => (Object.keys(initial) as (keyof Draft)[]).some((k) => draft[k] !== initial[k]),
    [draft, initial],
  );

  const set = (k: keyof Draft) => (v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    setBusy(true);
    // Empty strings → null so blanks don't shadow a real value.
    const payload = Object.fromEntries(
      (Object.keys(draft) as (keyof Draft)[]).map((k) => [
        k,
        draft[k].trim() === "" ? null : draft[k].trim(),
      ]),
    );
    const { data, error } = await supabase
      .from("contacts")
      .update(payload)
      .eq("id", contact.id)
      .select("id");
    setBusy(false);

    if (error) return toast.error(error.message);
    if (!data || data.length === 0)
      return toast.error("You don't have permission to edit this member.");
    toast.success("Details saved");
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal information</CardTitle>
        {canEdit && dirty && (
          <CardAction>
            <Button size="sm" onClick={save} disabled={busy}>
              Save changes
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name" value={draft.name} onChange={set("name")} disabled={!canEdit} />
          <Field label="Nickname" value={draft.nickname} onChange={set("nickname")} disabled={!canEdit} />
          <Field label="Birthday" type="date" value={draft.date_of_birth} onChange={set("date_of_birth")} disabled={!canEdit} />
          <Field label="Email" type="email" value={draft.email} onChange={set("email")} disabled={!canEdit} />
          <Field label="Phone" value={draft.phone} onChange={set("phone")} disabled={!canEdit} />
          {/* Gender — reuses GENDER_OPTIONS (same values as leads). */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Gender</Label>
            <Select
              value={draft.gender || undefined}
              onValueChange={(v) => set("gender")(v ?? "")}
              disabled={!canEdit}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Not specified" />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Address</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Address line 1" value={draft.address_line1} onChange={set("address_line1")} disabled={!canEdit} />
            <Field label="Address line 2" value={draft.address_line2} onChange={set("address_line2")} disabled={!canEdit} />
            <Field label="City" value={draft.city} onChange={set("city")} disabled={!canEdit} />
            <Field label="State / Province" value={draft.state} onChange={set("state")} disabled={!canEdit} />
            <Field label="Zip / Postal code" value={draft.postal_code} onChange={set("postal_code")} disabled={!canEdit} />
            <Field label="Country" value={draft.country} onChange={set("country")} disabled={!canEdit} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
