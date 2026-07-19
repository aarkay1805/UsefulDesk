import { describe, expect, it } from "vitest";
import {
  LEAD_STATUS_COLOR_OPTIONS,
  resolveSemanticColorPreset,
} from "./semantic-colors";

describe("resolveSemanticColorPreset", () => {
  it("maps the red lead preset to the canonical danger treatment", () => {
    expect(resolveSemanticColorPreset("#ef4444")).toEqual({
      badgeVariant: "danger",
      tint: "var(--color-red-500)",
      foreground: "var(--red-foreground)",
    });
  });

  it("maps success green to the same emerald family as fixed Paid badges", () => {
    expect(resolveSemanticColorPreset("#22C55E")).toEqual({
      badgeVariant: "success",
      tint: "var(--color-emerald-500)",
      foreground: "var(--emerald-foreground)",
    });
  });

  it("covers every editable lead-status colour", () => {
    for (const color of LEAD_STATUS_COLOR_OPTIONS) {
      expect(resolveSemanticColorPreset(color)).not.toBeNull();
    }
  });

  it("leaves arbitrary custom hex colours on the contrast-safe fallback", () => {
    expect(resolveSemanticColorPreset("#123456")).toBeNull();
    expect(resolveSemanticColorPreset(null)).toBeNull();
  });
});
