"use client";

import { useReducedMotion } from "motion/react";
import {
  BMI_ZONES,
  BMI_GAUGE_MAX,
  bmiZone,
  bmiGaugeFraction,
  roundBmi,
  type BmiTone,
} from "@/lib/bmi/bmi";

// Vivid, theme-neutral zone colours (read on both light and dark).
const TONE_HEX: Record<BmiTone, string> = {
  info: "#3b82f6", // blue — underweight
  success: "#22c55e", // green — normal
  warning: "#f59e0b", // amber — overweight
  danger: "#ef4444", // red — obese
};

// Gauge geometry, in viewBox units.
const W = 220;
const H = 128;
const CX = W / 2;
const CY = 112;
const R = 88;
const ARC_W = 16;

/** Point on the dial for a BMI fraction (0..1), y flipped to screen. */
function polar(fraction: number) {
  const theta = (180 * (1 - fraction) * Math.PI) / 180;
  return { x: CX + R * Math.cos(theta), y: CY - R * Math.sin(theta) };
}

/** Top-semicircle arc path between two BMI fractions (left→right, sweep=1). */
function arc(fromFrac: number, toFrac: number) {
  const s = polar(fromFrac);
  const e = polar(toFrac);
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

interface BmiGaugeProps {
  /** A positive, already-computed BMI. */
  bmi: number;
}

/**
 * Speedometer-style BMI dial — coloured WHO zone arcs under a needle
 * that settles on the current BMI. Pure SVG + a CSS-transitioned
 * rotation (no gauge dependency); honours reduced motion.
 */
export function BmiGauge({ bmi }: BmiGaugeProps) {
  const reduce = useReducedMotion();
  const zone = bmiZone(bmi);
  const frac = bmiGaugeFraction(bmi);
  // Needle: pointing up = frac 0.5; maps to [-90°, +90°].
  const needleDeg = 180 * frac - 90;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[240px]"
        role="img"
        aria-label={`BMI ${roundBmi(bmi)}, ${zone.label}`}
      >
        {/* Zone arcs (tiny gap between them via a fraction inset). */}
        {BMI_ZONES.map((z) => {
          const from = bmiGaugeFraction(z.min);
          const to = bmiGaugeFraction(Math.min(z.max, BMI_GAUGE_MAX));
          if (to - from < 0.001) return null;
          const gap = 0.006;
          return (
            <path
              key={z.category}
              d={arc(Math.min(from + gap, to), Math.max(to - gap, from))}
              fill="none"
              stroke={TONE_HEX[z.tone]}
              strokeWidth={ARC_W}
              strokeLinecap="round"
              opacity={z.category === zone.category ? 1 : 0.28}
            />
          );
        })}

        {/* Needle — rotates about the hub; CSS transition = the settle. */}
        <g
          style={{
            transform: `rotate(${needleDeg}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
            transformBox: "view-box",
            transition: reduce
              ? undefined
              : "transform 700ms cubic-bezier(0.34, 1.4, 0.64, 1)",
          }}
        >
          <path
            d={`M ${CX} ${CY - R + ARC_W / 2} L ${CX - 5} ${CY} L ${CX + 5} ${CY} Z`}
            className="fill-foreground"
          />
        </g>
        <circle cx={CX} cy={CY} r={7} className="fill-foreground" />
        <circle cx={CX} cy={CY} r={3} className="fill-background" />
      </svg>

      <div className="-mt-2 flex flex-col items-center">
        <span
          className="text-3xl font-semibold tabular-nums"
          style={{ color: TONE_HEX[zone.tone] }}
        >
          {roundBmi(bmi)}
        </span>
        <span
          className="text-sm font-medium"
          style={{ color: TONE_HEX[zone.tone] }}
        >
          {zone.label}
        </span>
      </div>
    </div>
  );
}
