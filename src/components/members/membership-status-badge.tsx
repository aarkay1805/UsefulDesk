import { Badge } from "@/components/ui/badge";
import type { MembershipStatus, MembershipFeeStatus, InvoiceStatus } from "@/types";

/**
 * Coloured pills for a membership's effective status and its fee state.
 * Kept in one place so the members table, detail view, and renewal
 * action lists all read the same colours. Thin wrappers over the Badge
 * primitive's tinted variants so the status → variant mapping stays
 * explicit and self-contained.
 */

const STATUS_VARIANT: Record<
  MembershipStatus,
  { label: string; variant: "success" | "danger" | "info" | "neutral" }
> = {
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "danger" },
  frozen: { label: "Frozen", variant: "info" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

/**
 * Renders the effective status. When `daysToExpiry` is supplied and the
 * membership is active and within the given window, it upgrades to an
 * amber "Expiring" pill so the renewal lists read at a glance.
 */
export function MembershipStatusBadge({
  status,
  daysToExpiry,
  expiringWithin = 7,
}: {
  status: MembershipStatus;
  daysToExpiry?: number;
  expiringWithin?: number;
}) {
  if (
    status === "active" &&
    typeof daysToExpiry === "number" &&
    daysToExpiry >= 0 &&
    daysToExpiry <= expiringWithin
  ) {
    const label =
      daysToExpiry === 0 ? "Expires today" : `Expires in ${daysToExpiry}d`;
    return <Badge variant="warning">{label}</Badge>;
  }
  const s = STATUS_VARIANT[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Invoice/billing-period status pill (migration 057). Paid = settled,
 * Unpaid = owed (current or overdue), Upcoming = a future cycle, Void =
 * cancelled cycle. Mirrors the membership status colour language.
 */
const INVOICE_VARIANT: Record<
  InvoiceStatus,
  { label: string; variant: "success" | "warning" | "info" | "neutral" }
> = {
  paid: { label: "Paid", variant: "success" },
  unpaid: { label: "Unpaid", variant: "warning" },
  upcoming: { label: "Upcoming", variant: "info" },
  void: { label: "Void", variant: "neutral" },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = INVOICE_VARIANT[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function FeeStatusBadge({ status }: { status: MembershipFeeStatus }) {
  return status === "paid" ? (
    <Badge variant="success">Paid</Badge>
  ) : (
    <Badge variant="warning">Fee due</Badge>
  );
}

/**
 * Marks a membership row as a trial/lead (not a paying member yet).
 * Orthogonal to the status pill — a trial is `is_trial=true` on top of
 * an active/expired status — so it renders as its own violet pill.
 */
export function TrialBadge() {
  return <Badge variant="violet">Trial</Badge>;
}
