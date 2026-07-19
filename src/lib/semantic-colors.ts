export type SemanticBadgeVariant =
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "violet"
  | "orange"
  | "pink"
  | "neutral";

export interface SemanticColorPreset {
  badgeVariant: SemanticBadgeVariant;
  /** Canonical Tailwind primitive used for the subtle fill. */
  tint: string;
  /** Canonical mode-aware foreground token for this colour family. */
  foreground: string;
}

/**
 * Stable values persisted by the lead-status colour picker. Their display
 * primitives are resolved below, so legacy Tailwind-v3 hex values and the
 * current Tailwind-v4 palette cannot make otherwise identical badges drift.
 */
export const LEAD_STATUS_COLOR_OPTIONS = [
  "#eab308", // warning / amber
  "#f97316", // orange
  "#22c55e", // success / emerald
  "#ef4444", // danger / red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#64748b", // neutral / slate
] as const;

const PRESET_BY_HEX: Record<string, SemanticColorPreset> = {
  "#3b82f6": {
    badgeVariant: "info",
    tint: "var(--color-sky-500)",
    foreground: "var(--sky-foreground)",
  },
  "#eab308": {
    badgeVariant: "warning",
    tint: "var(--color-amber-500)",
    foreground: "var(--amber-foreground)",
  },
  // Older accounts may carry Tailwind's amber rather than yellow preset.
  "#f59e0b": {
    badgeVariant: "warning",
    tint: "var(--color-amber-500)",
    foreground: "var(--amber-foreground)",
  },
  "#f97316": {
    badgeVariant: "orange",
    tint: "var(--color-orange-500)",
    foreground: "var(--orange-foreground)",
  },
  "#22c55e": {
    badgeVariant: "success",
    tint: "var(--color-emerald-500)",
    foreground: "var(--emerald-foreground)",
  },
  "#ef4444": {
    badgeVariant: "danger",
    tint: "var(--color-red-500)",
    foreground: "var(--red-foreground)",
  },
  "#8b5cf6": {
    badgeVariant: "violet",
    tint: "var(--color-violet-500)",
    foreground: "var(--violet-foreground)",
  },
  "#ec4899": {
    badgeVariant: "pink",
    tint: "var(--color-pink-500)",
    foreground: "var(--pink-foreground)",
  },
  "#64748b": {
    badgeVariant: "neutral",
    tint: "var(--color-slate-500)",
    foreground: "var(--slate-foreground)",
  },
};

export function resolveSemanticColorPreset(
  color: string | null | undefined,
): SemanticColorPreset | null {
  if (!color) return null;
  return PRESET_BY_HEX[color.trim().toLowerCase()] ?? null;
}
