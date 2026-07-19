/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Badge shape: bg-*-500/10 + text-*-foreground (fill-only, matching the
 * Badge primitive's tinted variants). Foregrounds resolve through the shared
 * mode-aware hue tokens, including slate for neutral statuses.
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "Draft",
    classes: "bg-slate-500/10 text-slate-foreground",
  },
  scheduled: {
    label: "Scheduled",
    classes: "bg-blue-500/10 text-blue-foreground",
  },
  sending: {
    label: "Sending",
    classes: "bg-yellow-500/10 text-yellow-foreground",
    pulse: true,
  },
  sent: {
    label: "Sent",
    classes: "bg-primary/10 text-primary-text",
  },
  failed: {
    label: "Failed",
    classes: "bg-red-500/10 text-red-foreground",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "Pending",
    classes: "bg-slate-500/10 text-slate-foreground",
  },
  sent: {
    label: "Sent",
    classes: "bg-blue-500/10 text-blue-foreground",
  },
  delivered: {
    label: "Delivered",
    classes: "bg-primary/10 text-primary-text",
  },
  read: {
    label: "Read",
    classes: "bg-primary/10 text-primary-text",
  },
  replied: {
    label: "Replied",
    classes: "bg-purple-500/10 text-purple-foreground",
  },
  failed: {
    label: "Failed",
    classes: "bg-red-500/10 text-red-foreground",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
