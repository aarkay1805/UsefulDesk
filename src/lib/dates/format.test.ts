import { describe, expect, it } from "vitest";

import { formatDay } from "./format";

describe("formatDay", () => {
  it("formats a plain YYYY-MM-DD from its parts (no timezone shift)", () => {
    expect(formatDay("2026-07-11")).toBe("Jul 11, 2026");
    expect(formatDay("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDay("2025-12-31")).toBe("Dec 31, 2025");
  });

  it("formats a full ISO timestamp via locale rules", () => {
    // Timestamps carry a zone, so Date parsing is safe; just assert shape.
    expect(formatDay("2026-07-11T10:30:00+05:30")).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/
    );
  });
});
