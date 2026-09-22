export type LegalBusinessNameResult =
  | { ok: true; name: string }
  | {
      ok: false;
      code:
        | 'legal_business_identity_missing'
        | 'legal_business_identity_lookup_unavailable';
    };

type LegalEntityRow = {
  legal_name?: string | null;
  name?: string | null;
};

type LegalBusinessNameDb = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        maybeSingle(): PromiseLike<{
          data: unknown;
          error: unknown;
        }>;
      };
    };
  };
};

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveLegalBusinessName(
  entity: LegalEntityRow | null | undefined
): string | null {
  return trimmed(entity?.legal_name) ?? trimmed(entity?.name);
}

export function applyLegalBusinessNameParam(
  params: readonly string[],
  expectedCount: number,
  legalBusinessName: string
): string[] {
  const canonicalName = legalBusinessName.trim();
  if (params.length === expectedCount - 1) return [...params, canonicalName];
  if (params.length === expectedCount) {
    return [...params.slice(0, -1), canonicalName];
  }
  return [...params];
}

export async function loadLegalBusinessName(
  db: LegalBusinessNameDb,
  accountId: string
): Promise<LegalBusinessNameResult> {
  const { data, error } = await db
    .from('accounts')
    .select('legal_entity:legal_entities(legal_name, name)')
    .eq('id', accountId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      code: 'legal_business_identity_lookup_unavailable',
    };
  }

  const legalEntity = (data as { legal_entity?: unknown } | null)?.legal_entity;
  const entity = Array.isArray(legalEntity) ? legalEntity[0] : legalEntity;
  const name = resolveLegalBusinessName(entity as LegalEntityRow | null);
  return name
    ? { ok: true, name }
    : { ok: false, code: 'legal_business_identity_missing' };
}
