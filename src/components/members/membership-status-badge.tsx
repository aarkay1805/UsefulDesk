import type { MembershipStatus, MembershipFeeStatus } from "@/types";

/**
 * Coloured pills for a membership's effective status and its fee state.
 * Kept in one place so the members table, detail view, and renewal
 * action lists all read the same colours. These are plain spans (not
 * the Badge primitive) so the status → colour mapping stays explicit
 * and self-contained.
 */

const STATUS_STYLE: Record<MembershipStatus, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  },
  expired: {
    label: "Expired",
    className: "border-red-500/40 bg-red-500/10 text-red-400",
  },
  frozen: {
    label: "Frozen",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  },
  cancelled: {
    label: "Cancelled",
    className: "border-border bg-muted text-muted-foreground",
  },
};

function pill(className: string, label: string) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

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
    return pill("border-amber-500/40 bg-amber-500/10 text-amber-400", label);
  }
  const s = STATUS_STYLE[status];
  return pill(s.className, s.label);
}

export function FeeStatusBadge({ status }: { status: MembershipFeeStatus }) {
  return status === "paid"
    ? pill("border-emerald-500/40 bg-emerald-500/10 text-emerald-400", "Paid")
    : pill("border-amber-500/40 bg-amber-500/10 text-amber-400", "Fee due");
}

/**
 * Marks a membership row as a trial/lead (not a paying member yet).
 * Orthogonal to the status pill — a trial is `is_trial=true` on top of
 * an active/expired status — so it renders as its own violet pill.
 */
export function TrialBadge() {
  return pill(
    "border-violet-500/40 bg-violet-500/10 text-violet-400",
    "Trial",
  );
}
