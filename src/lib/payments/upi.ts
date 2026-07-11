/**
 * UPI deep-link helpers (migration 038).
 *
 * v1 of "collect on UPI": mint `upi://pay?...` links for exact due
 * amounts from the account's stored VPA. Any UPI app (GPay, PhonePe,
 * Paytm, BHIM) opens them with payee + amount pre-filled; no gateway
 * involved, staff still record the collection manually.
 */

/** NPCI VPA shape: handle@psp — mirrors the DB CHECK in 038. */
const VPA_RE = /^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/;

/**
 * UPI is an India-only payment rail — offered only when the account
 * bills in INR (a CURRENCY condition, not a country conditional; the
 * hardcoded `cu=INR` in the link below is correct for the rail itself).
 */
export function upiAvailableFor(currency: string): boolean {
  return currency === "INR";
}

export function isValidVpa(vpa: string): boolean {
  return VPA_RE.test(vpa.trim());
}

export interface UpiLinkParams {
  /** Payee VPA, e.g. gym@okhdfcbank. */
  vpa: string;
  /** Payee display name shown in the payer's UPI app. */
  payeeName?: string | null;
  /** Amount in INR; omitted from the link when not a positive number,
   *  letting the payer type one. */
  amount?: number | null;
  /** Transaction note shown to the payer, e.g. "Gym renewal — July". */
  note?: string | null;
}

/**
 * Build a `upi://pay` deep link. Parameters are URL-encoded; the
 * amount is fixed to two decimals (UPI apps reject weird precision).
 */
export function buildUpiLink({ vpa, payeeName, amount, note }: UpiLinkParams): string {
  const params = new URLSearchParams();
  params.set("pa", vpa.trim());
  if (payeeName?.trim()) params.set("pn", payeeName.trim());
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
    params.set("am", amount.toFixed(2));
    params.set("cu", "INR");
  }
  if (note?.trim()) params.set("tn", note.trim());
  return `upi://pay?${params.toString()}`;
}
