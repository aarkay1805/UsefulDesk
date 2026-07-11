import { describe, expect, it } from "vitest";

import { validatePaymentAmount } from "./validation";

describe("validatePaymentAmount", () => {
  it("accepts a positive partial or exact-balance payment", () => {
    expect(validatePaymentAmount(250, 1000)).toBe("valid");
    expect(validatePaymentAmount(1000, 1000)).toBe("valid");
  });

  it("rejects zero and negative ledger rows", () => {
    expect(validatePaymentAmount(0, 1000)).toBe("not_positive");
    expect(validatePaymentAmount(-1, 1000)).toBe("not_positive");
  });

  it("rejects overpayments and non-finite input", () => {
    expect(validatePaymentAmount(1000.01, 1000)).toBe("exceeds_balance");
    expect(validatePaymentAmount(Number.NaN, 1000)).toBe("invalid");
  });
});
