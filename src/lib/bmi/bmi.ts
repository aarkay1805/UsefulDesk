// ============================================================
// BMI — pure math, WHO zones, and metric<->imperial conversions.
//
// No React, no I/O — every value here is unit-testable. Storage is
// always metric (contacts.height_cm / weight_kg, migration 056); the
// imperial helpers exist only so an imperial-locale account can enter
// and read ft-in / lb while the DB stays canonical cm / kg.
//
// Standard WHO BMI is gender- and age-independent: bmi = kg / m^2.
// ============================================================

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

/** Colour tone for the gauge arc — maps to the Badge tint family. */
export type BmiTone = "info" | "success" | "warning" | "danger";

export interface BmiZone {
  category: BmiCategory;
  label: string;
  /** Inclusive lower BMI bound. */
  min: number;
  /** Exclusive upper BMI bound (Infinity on the last zone). */
  max: number;
  tone: BmiTone;
}

/** WHO adult BMI categories, low to high. */
export const BMI_ZONES: readonly BmiZone[] = [
  { category: "underweight", label: "Underweight", min: 0, max: 18.5, tone: "info" },
  { category: "normal", label: "Normal", min: 18.5, max: 25, tone: "success" },
  { category: "overweight", label: "Overweight", min: 25, max: 30, tone: "warning" },
  { category: "obese", label: "Obese", min: 30, max: Infinity, tone: "danger" },
];

/** Visible BMI range on the gauge dial (needle clamps to these). */
export const BMI_GAUGE_MIN = 10;
export const BMI_GAUGE_MAX = 40;

/**
 * BMI from metric inputs, or null when either is missing/non-positive
 * (so callers render the "add measurements" empty state).
 */
export function computeBmi(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined,
): number | null {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return null;
  const m = h / 100;
  return w / (m * m);
}

/** Round a BMI to one decimal, the convention on health cards. */
export function roundBmi(bmi: number): number {
  return Math.round(bmi * 10) / 10;
}

/** The WHO zone a BMI falls in (defaults to the last/first at the edges). */
export function bmiZone(bmi: number): BmiZone {
  return (
    BMI_ZONES.find((z) => bmi >= z.min && bmi < z.max) ??
    (bmi < BMI_ZONES[0].min ? BMI_ZONES[0] : BMI_ZONES[BMI_ZONES.length - 1])
  );
}

/**
 * BMI mapped to a 0..1 position along the gauge dial, clamped to the
 * visible range. Drives both the needle angle and zone arc lengths.
 */
export function bmiGaugeFraction(bmi: number): number {
  const f = (bmi - BMI_GAUGE_MIN) / (BMI_GAUGE_MAX - BMI_GAUGE_MIN);
  return Math.min(1, Math.max(0, f));
}

// ── Unit conversions ────────────────────────────────────────────────

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;
const LB_PER_KG = 2.2046226218;

export interface FeetInches {
  feet: number;
  inches: number;
}

/** cm → { feet, inches } with inches rounded to the nearest whole. */
export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH);
  let feet = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = totalInches - feet * INCHES_PER_FOOT;
  if (inches === INCHES_PER_FOOT) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

/** { feet, inches } → cm (rounded to 1 dp to fit NUMERIC(5,2)). */
export function feetInchesToCm(feet: number, inches: number): number {
  const totalInches = (Number(feet) || 0) * INCHES_PER_FOOT + (Number(inches) || 0);
  return Math.round(totalInches * CM_PER_INCH * 10) / 10;
}

/** kg → lb (1 dp). */
export function kgToLb(kg: number): number {
  return Math.round(kg * LB_PER_KG * 10) / 10;
}

/** lb → kg (1 dp). */
export function lbToKg(lb: number): number {
  return Math.round((Number(lb) || 0) / LB_PER_KG * 10) / 10;
}
