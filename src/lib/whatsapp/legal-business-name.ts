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
  rpc?(functionName: string): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveLegalBusinessName(
  entity: LegalEntityRow | null | undefined
): string | null {
  return trimmed(entity?.legal_name);
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
    .select('legal_entity:legal_entities(legal_name)')
    .eq('id', accountId)
    .maybeSingle();
  const legalEntity = (data as { legal_entity?: unknown } | null)?.legal_entity;
  const entity = Array.isArray(legalEntity) ? legalEntity[0] : legalEntity;
  const name = resolveLegalBusinessName(entity as LegalEntityRow | null);
  if (name) return { ok: true, name };

  // RLS exposes legal_entities directly only to organization owners. Branch
  // members receive the same canonical name from this authenticated RPC.
  if (db.rpc) {
    const branches = await db.rpc('my_branch_accounts');
    if (branches.error) {
      return {
        ok: false,
        code: 'legal_business_identity_lookup_unavailable',
      };
    }
    const branch = Array.isArray(branches.data)
      ? branches.data.find(
          (row: unknown) =>
            (row as { account_id?: unknown })?.account_id === accountId
        )
      : null;
    const branchRow = branch as {
      legal_entity_name?: unknown;
      legal_entity_legal_name?: unknown;
    } | null;
    // During app-first rollout, the old RPC has only legal_entity_name,
    // which is its canonical legal-name projection. The new RPC returns an
    // explicit null until a legal name is entered; never fall back then.
    const branchName = trimmed(
      branchRow &&
        Object.prototype.hasOwnProperty.call(
          branchRow,
          'legal_entity_legal_name'
        )
        ? branchRow.legal_entity_legal_name
        : branchRow?.legal_entity_name
    );
    if (branchName) return { ok: true, name: branchName };
  }

  return {
    ok: false,
    code: error
      ? 'legal_business_identity_lookup_unavailable'
      : 'legal_business_identity_missing',
  };
}
