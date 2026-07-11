import { describe, it, expect } from "vitest";
import {
  computeBmi,
  roundBmi,
  bmiZone,
  bmiGaugeFraction,
  cmToFeetInches,
  feetInchesToCm,
  kgToLb,
  lbToKg,
  BMI_GAUGE_MIN,
  BMI_GAUGE_MAX,
} from "./bmi";

describe("computeBmi", () => {
  it("computes kg/m^2", () => {
    // 70.15kg / 1.8^2 = 21.65...
    expect(roundBmi(computeBmi(180, 70.15)!)).toBe(21.7);
    expect(roundBmi(computeBmi(170, 65)!)).toBe(22.5);
  });

  it("returns null for missing or non-positive inputs", () => {
    expect(computeBmi(null, 70)).toBeNull();
    expect(computeBmi(180, null)).toBeNull();
    expect(computeBmi(0, 70)).toBeNull();
    expect(computeBmi(180, -5)).toBeNull();
    expect(computeBmi(undefined, undefined)).toBeNull();
  });
});

describe("bmiZone", () => {
  it("maps WHO categories at the boundaries", () => {
    expect(bmiZone(17).category).toBe("underweight");
    expect(bmiZone(18.5).category).toBe("normal");
    expect(bmiZone(24.9).category).toBe("normal");
    expect(bmiZone(25).category).toBe("overweight");
    expect(bmiZone(29.9).category).toBe("overweight");
    expect(bmiZone(30).category).toBe("obese");
    expect(bmiZone(45).category).toBe("obese");
  });

  it("clamps below zero to the first zone", () => {
    expect(bmiZone(-3).category).toBe("underweight");
  });
});

describe("bmiGaugeFraction", () => {
  it("clamps to 0..1 across the visible range", () => {
    expect(bmiGaugeFraction(BMI_GAUGE_MIN)).toBe(0);
    expect(bmiGaugeFraction(BMI_GAUGE_MAX)).toBe(1);
    expect(bmiGaugeFraction((BMI_GAUGE_MIN + BMI_GAUGE_MAX) / 2)).toBeCloseTo(0.5);
    expect(bmiGaugeFraction(5)).toBe(0);
    expect(bmiGaugeFraction(100)).toBe(1);
  });
});

describe("unit conversions", () => {
  it("cm <-> ft/in round-trips within an inch", () => {
    expect(cmToFeetInches(180)).toEqual({ feet: 5, inches: 11 });
    expect(cmToFeetInches(152.4)).toEqual({ feet: 5, inches: 0 });
    // Carries when inches round up to 12.
    expect(cmToFeetInches(179.5).inches).toBeLessThan(12);
  });

  it("feetInchesToCm converts", () => {
    expect(feetInchesToCm(5, 11)).toBeCloseTo(180.3, 1);
    expect(feetInchesToCm(6, 0)).toBeCloseTo(182.9, 1);
  });

  it("kg <-> lb", () => {
    expect(kgToLb(70)).toBeCloseTo(154.3, 1);
    expect(lbToKg(154.3)).toBeCloseTo(70, 0);
  });
});
