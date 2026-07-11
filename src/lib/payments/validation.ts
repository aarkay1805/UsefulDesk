/** Pure guards shared by every client payment form. The database repeats
 * these checks because UI validation is convenience, not authorization. */
export type PaymentAmountValidation = "valid" | "invalid" | "not_positive" | "exceeds_balance";

export function validatePaymentAmount(amount: number, balance: number): PaymentAmountValidation {
  if (!Number.isFinite(amount) || !Number.isFinite(balance)) return "invalid";
  if (amount <= 0) return "not_positive";
  if (amount > balance) return "exceeds_balance";
  return "valid";
}
