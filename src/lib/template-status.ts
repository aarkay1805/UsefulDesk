/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + dark-theme badge classes here so the template manager,
 * inbox picker, and broadcast picker stay aligned.
 */

import type { MessageTemplateStatus } from '@/types';

export interface TemplateStatusDisplay {
  label: string;
  classes: string;
}

export const templateStatusConfig: Record<
  MessageTemplateStatus,
  TemplateStatusDisplay
> = {
  DRAFT: {
    label: 'Draft',
    classes: 'bg-slate-600/20 text-muted-foreground',
  },
  PENDING: {
    label: 'Pending',
    classes: 'bg-yellow-600/20 text-yellow-400',
  },
  APPROVED: {
    label: 'Approved',
    classes: 'bg-primary/20 text-primary',
  },
  REJECTED: {
    label: 'Rejected',
    classes: 'bg-red-600/20 text-red-400',
  },
  PAUSED: {
    label: 'Paused',
    classes: 'bg-orange-600/20 text-orange-400',
  },
  DISABLED: {
    label: 'Disabled',
    classes: 'bg-red-900/30 text-red-500',
  },
  IN_APPEAL: {
    label: 'In Appeal',
    classes: 'bg-blue-600/20 text-blue-400',
  },
  PENDING_DELETION: {
    label: 'Pending Deletion',
    classes: 'bg-slate-700/30 text-muted-foreground',
  },
};
