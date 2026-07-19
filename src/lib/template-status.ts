/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + token-backed badge classes here so the template manager,
 * inbox picker, and broadcast picker stay aligned in both modes.
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
    classes: 'bg-slate-600/20 text-slate-foreground',
  },
  PENDING: {
    label: 'Pending',
    classes: 'bg-yellow-600/20 text-yellow-foreground',
  },
  APPROVED: {
    label: 'Approved',
    classes: 'bg-primary/20 text-primary-text',
  },
  REJECTED: {
    label: 'Rejected',
    classes: 'bg-red-600/20 text-red-foreground',
  },
  PAUSED: {
    label: 'Paused',
    classes: 'bg-orange-600/20 text-orange-foreground',
  },
  DISABLED: {
    label: 'Disabled',
    classes: 'bg-red-900/30 text-red-foreground',
  },
  IN_APPEAL: {
    label: 'In Appeal',
    classes: 'bg-blue-600/20 text-blue-foreground',
  },
  PENDING_DELETION: {
    label: 'Pending Deletion',
    classes: 'bg-slate-700/30 text-slate-foreground',
  },
};
