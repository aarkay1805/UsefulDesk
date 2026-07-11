"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Activity, Pencil, Ruler } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  computeBmi,
  cmToFeetInches,
  feetInchesToCm,
  kgToLb,
  lbToKg,
} from "@/lib/bmi/bmi";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BmiGauge } from "./bmi-gauge";

interface BmiCardProps {
  contactId: string;
  heightCm: number | null | undefined;
  weightKg: number | null | undefined;
  /** Account measurement system — 'imperial' shows ft-in / lb. */
  measurementSystem: string;
  canEdit: boolean;
  /** Refetch the sheet after a save. */
  onSaved: () => void;
}

/** Metric height/weight formatted for display in the account's system. */
function formatHeight(cm: number, imperial: boolean): string {
  if (imperial) {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet}′ ${inches}″`;
  }
  return `${cm} cm`;
}
function formatWeight(kg: number, imperial: boolean): string {
  return imperial ? `${kgToLb(kg)} lb` : `${kg} kg`;
}

/**
 * BMI widget for the member sheet rail. Reads height/weight off the
 * contact (metric-canonical), shows the WHO gauge, and lets an editor
 * enter/update measurements — converting to/from imperial when the
 * account uses it. Missing measurements → an "Add measurements" prompt.
 */
export function BmiCard({
  contactId,
  heightCm,
  weightKg,
  measurementSystem,
  canEdit,
  onSaved,
}: BmiCardProps) {
  const supabase = createClient();
  const imperial = measurementSystem === "imperial";

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Draft inputs — seeded from the stored metric values, in the
  // account's own units.
  const seededFi = heightCm ? cmToFeetInches(heightCm) : { feet: 0, inches: 0 };
  const [cm, setCm] = useState(heightCm ? String(heightCm) : "");
  const [feet, setFeet] = useState(heightCm ? String(seededFi.feet) : "");
  const [inches, setInches] = useState(heightCm ? String(seededFi.inches) : "");
  const [kg, setKg] = useState(weightKg ? String(weightKg) : "");
  const [lb, setLb] = useState(weightKg ? String(kgToLb(weightKg)) : "");

  const bmi = computeBmi(heightCm, weightKg);
  const hasData = bmi !== null;

  function startEdit() {
    // Re-seed drafts from the latest stored values.
    const fi = heightCm ? cmToFeetInches(heightCm) : { feet: 0, inches: 0 };
    setCm(heightCm ? String(heightCm) : "");
    setFeet(heightCm ? String(fi.feet) : "");
    setInches(heightCm ? String(fi.inches) : "");
    setKg(weightKg ? String(weightKg) : "");
    setLb(weightKg ? String(kgToLb(weightKg)) : "");
    setEditing(true);
  }

  async function save() {
    // Resolve drafts to canonical metric.
    let nextHeight: number | null = null;
    let nextWeight: number | null = null;

    if (imperial) {
      const f = Number(feet) || 0;
      const i = Number(inches) || 0;
      if (f > 0 || i > 0) nextHeight = feetInchesToCm(f, i);
      const l = Number(lb) || 0;
      if (l > 0) nextWeight = lbToKg(l);
    } else {
      const c = Number(cm) || 0;
      if (c > 0) nextHeight = Math.round(c * 10) / 10;
      const k = Number(kg) || 0;
      if (k > 0) nextWeight = Math.round(k * 10) / 10;
    }

    setBusy(true);
    // Chain .select — an RLS-blocked update returns zero rows, no error
    // (silent-write rule), so treat an empty result as failure.
    const { data, error } = await supabase
      .from("contacts")
      .update({ height_cm: nextHeight, weight_kg: nextWeight })
      .eq("id", contactId)
      .select("id");
    setBusy(false);

    if (error) return toast.error(error.message);
    if (!data || data.length === 0)
      return toast.error("You don't have permission to update measurements.");

    toast.success("Measurements saved");
    setEditing(false);
    onSaved();
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>BMI</CardTitle>
        {canEdit && hasData && !editing && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={startEdit}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="flex flex-col gap-3">
            {/* Height */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Ruler className="size-3.5" /> Height
              </label>
              {imperial ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={feet}
                    onChange={(e) => setFeet(e.target.value)}
                    placeholder="ft"
                    aria-label="Height feet"
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={inches}
                    onChange={(e) => setInches(e.target.value)}
                    placeholder="in"
                    aria-label="Height inches"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={cm}
                    onChange={(e) => setCm(e.target.value)}
                    placeholder="cm"
                    aria-label="Height in centimetres"
                  />
                  <span className="text-sm text-muted-foreground">cm</span>
                </div>
              )}
            </div>

            {/* Weight */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Activity className="size-3.5" /> Weight
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={imperial ? lb : kg}
                  onChange={(e) =>
                    imperial ? setLb(e.target.value) : setKg(e.target.value)
                  }
                  placeholder={imperial ? "lb" : "kg"}
                  aria-label={imperial ? "Weight in pounds" : "Weight in kilograms"}
                />
                <span className="text-sm text-muted-foreground">
                  {imperial ? "lb" : "kg"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={busy}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : hasData ? (
          <div className="flex flex-col gap-3">
            <BmiGauge bmi={bmi} />
            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              <div>
                <dt className="text-xs text-muted-foreground">Height</dt>
                <dd className="mt-0.5 text-sm font-medium">
                  {formatHeight(heightCm!, imperial)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Weight</dt>
                <dd className="mt-0.5 text-sm font-medium">
                  {formatWeight(weightKg!, imperial)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <p className="text-sm text-muted-foreground">
              No measurements yet — add height and weight to calculate BMI.
            </p>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Ruler className="size-3.5" /> Add measurements
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
