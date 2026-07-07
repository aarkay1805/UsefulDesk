'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { LeadColumn } from '@/lib/leads/status';
import {
  optionLabel,
  resolveFieldOptions,
  statusColumn,
  statusColumns,
  type LeadFieldKind,
  type LeadFieldOption,
} from '@/lib/leads/field-options';

interface FieldOptionRow extends LeadFieldOption {
  field: LeadFieldKind;
}

/**
 * The account's option lists for the lead attribute fields
 * (status / source / gender), falling back to the built-in defaults
 * while loading or when the account has never customised a list.
 *
 * `statuses` includes the fixed "New" (NULL) bucket first, ready for
 * the board/table. Call `refetch()` after the Edit-options dialog
 * saves.
 */
export function useLeadFieldOptions() {
  const { accountId } = useAuth();
  const [rows, setRows] = useState<FieldOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('lead_field_options')
        .select('field, key, label, color')
        .eq('account_id', accountId)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setRows((data as FieldOptionRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo(() => {
    const byField = (kind: LeadFieldKind) =>
      resolveFieldOptions(
        kind,
        rows.filter((r) => r.field === kind),
      );
    const statusOptions = byField('status');
    const sources = byField('source');
    const genders = byField('gender');
    const columns = statusColumns(statusOptions);
    return {
      loading,
      refetch,
      /** Raw saved/default option lists (no 'new'). */
      statusOptions,
      sources,
      genders,
      /** Board/table columns — fixed 'new' first. */
      statuses: columns,
      /** Presentation for a stored status key (never throws). */
      statusFor: (key: string | null | undefined): LeadColumn =>
        statusColumn(columns, key),
      sourceLabel: (value: string | null | undefined) =>
        optionLabel(sources, value),
      genderLabel: (value: string | null | undefined) =>
        optionLabel(genders, value),
    };
  }, [rows, loading, refetch]);
}
