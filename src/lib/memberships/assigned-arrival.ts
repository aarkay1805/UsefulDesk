import type { SupabaseClient } from '@supabase/supabase-js';

/** One optional recurring gym-local arrival time, in half-hour steps. */
export function assignedArrivalOptions(format: (value: string) => string) {
  return [
    { value: '', label: 'Not assigned' },
    ...Array.from({ length: 48 }, (_, slot) => {
      const value = `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
      return { value, label: format(value) };
    }),
  ];
}

/** Postgres TIME serializes with seconds; the picker uses HH:mm. */
export function normalizeAssignedArrivalTime(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const match = /^(\d{2}):(00|30)(?::00)?$/.exec(value);
  if (!match || Number(match[1]) > 23) return null;
  return `${match[1]}:${match[2]}`;
}

/** Accept common 12h/24h CSV clocks, while preserving the half-hour rule. */
export function parseImportedAssignedArrivalTime(input: string): string | null {
  const match = /^(\d{1,2}):(00|30)\s*(am|pm)?$/i.exec(input.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const period = match[3]?.toLowerCase();
  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (period === 'pm' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

export async function saveAssignedArrivalTime(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string,
  rawValue: string
): Promise<string | null> {
  const value = rawValue === '' ? null : normalizeAssignedArrivalTime(rawValue);
  if (rawValue !== '' && !value) {
    throw new Error('Choose a 30-minute arrival time');
  }
  const { data, error } = await supabase
    .from('contacts')
    .update({ assigned_arrival_time: value })
    .eq('id', contactId)
    .eq('account_id', accountId)
    .select('id');
  if (error) throw error;
  if (!data?.some((row) => row.id === contactId)) {
    throw new Error('Could not update assigned arrival');
  }
  return value;
}
