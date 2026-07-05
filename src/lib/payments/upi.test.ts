import { describe, it, expect } from "vitest";
import { isValidVpa, buildUpiLink } from "./upi";

describe("isValidVpa", () => {
  it("accepts standard handle@psp shapes", () => {
    expect(isValidVpa("gym@okhdfcbank")).toBe(true);
    expect(isValidVpa("iron.fitness-1@ybl")).toBe(true);
    expect(isValidVpa("  9876543210@paytm ")).toBe(true); // trimmed
  });

  it("rejects malformed values", () => {
    expect(isValidVpa("")).toBe(false);
    expect(isValidVpa("no-at-sign")).toBe(false);
    expect(isValidVpa("a@b1")).toBe(false); // digits in PSP suffix
    expect(isValidVpa("@ybl")).toBe(false); // empty handle
    expect(isValidVpa("gym@")).toBe(false);
    expect(isValidVpa("gym name@ybl")).toBe(false); // space
  });
});

describe("buildUpiLink", () => {
  it("builds a full link with amount fixed to two decimals", () => {
    expect(
      buildUpiLink({
        vpa: "gym@ybl",
        payeeName: "Iron Fitness",
        amount: 1500,
        note: "Renewal",
      }),
    ).toBe("upi://pay?pa=gym%40ybl&pn=Iron+Fitness&am=1500.00&cu=INR&tn=Renewal");
  });

  it("omits amount (and currency) when not a positive number", () => {
    expect(buildUpiLink({ vpa: "gym@ybl", amount: 0 })).toBe("upi://pay?pa=gym%40ybl");
    expect(buildUpiLink({ vpa: "gym@ybl", amount: null })).toBe("upi://pay?pa=gym%40ybl");
    expect(buildUpiLink({ vpa: "gym@ybl", amount: NaN })).toBe("upi://pay?pa=gym%40ybl");
  });

  it("omits blank payee name and note", () => {
    expect(buildUpiLink({ vpa: "gym@ybl", payeeName: "  ", note: "" })).toBe(
      "upi://pay?pa=gym%40ybl",
    );
  });

  it("URL-encodes note text", () => {
    expect(
      buildUpiLink({ vpa: "gym@ybl", note: "July fee — Rahul" }),
    ).toContain("tn=July+fee+%E2%80%94+Rahul");
  });
});
