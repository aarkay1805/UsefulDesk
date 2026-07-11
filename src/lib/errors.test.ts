import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("returns a native Error message", () => {
    expect(getErrorMessage(new Error("Network unavailable"), "Fallback")).toBe(
      "Network unavailable",
    );
  });

  it("returns a Supabase-style plain-object message", () => {
    expect(
      getErrorMessage(
        { code: "PGRST202", message: "Database function is unavailable" },
        "Fallback",
      ),
    ).toBe("Database function is unavailable");
  });

  it("uses the fallback when no useful message exists", () => {
    expect(getErrorMessage({ message: " " }, "Fallback")).toBe("Fallback");
  });
});
