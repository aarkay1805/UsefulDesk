import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260829010000_consolidate_leads_listing.sql';
const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations', migrationName),
  'utf8'
);
const page = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/leads/page.tsx'),
  'utf8'
);

describe('lead listing SQL contract', () => {
  it('is the latest idempotent invoker migration with an authenticated-only ACL', () => {
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    expect(migrations.at(-1)).toBe(migrationName);
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.lead_listing_snapshot('
    );
    expect(migration).toContain('STABLE');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('public.is_account_member(p_account_id)');
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain('OWNER TO postgres');
    expect(migration).toContain('FROM PUBLIC, anon, service_role');
    expect(migration).toContain('TO authenticated');
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(migration).not.toMatch(/TO\s+service_role/i);
    expect(migration.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });

  it('allowlists every mode, quick filter, and direct or related sort', () => {
    for (const value of ['table', 'board', 'ids', 'export']) {
      expect(migration).toContain(`'${value}'`);
    }
    for (const value of [
      'all',
      'no_followup',
      'unassigned',
      'mine',
      'new_today',
    ]) {
      expect(migration).toContain(`'${value}'`);
    }
    for (const value of [
      'name',
      'lead_status',
      'phone',
      'email',
      'company',
      'source',
      'gender',
      'received_via',
      'created_at',
      'assigned_name',
      'created_by_name',
      'tag_name',
      'custom',
    ]) {
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).toContain("v_sort_direction NOT IN ('asc', 'desc')");
    expect(migration).toContain("v_mode = 'board'");
    expect(migration).toContain('p_page_size > 500');
    expect(migration).toContain("v_mode IN ('ids', 'export')");
  });

  it('derives and reuses one lead cohort with parity-safe filter predicates', () => {
    expect(migration).toContain('filtered_leads AS MATERIALIZED');
    expect(migration).toContain('active_leads AS MATERIALIZED');
    expect(migration).toContain('FROM filtered_leads AS filtered');
    expect(migration).toContain('FROM public.memberships AS membership');
    expect(migration).toContain('membership.contact_id = contact.id');
    expect(migration).toContain("'new' = ANY(v_lead_statuses)");
    expect(migration).toContain('contact.lead_status IS NULL');
    expect(migration).toContain(
      "contact.lead_status IS NULL OR contact.lead_status <> 'lost'"
    );
    expect(migration).toContain("follow_up.status = 'open'");
    expect(migration).toContain('link.tag_id = ANY(v_tag_ids)');
    expect(migration).toContain('jsonb_each(v_custom_filters)');
    expect(migration).toContain('WHERE NOT EXISTS (');
    expect(migration).toContain(
      'stored.custom_field_id = dimension.field_id::UUID'
    );
    expect(migration).toContain(
      'contact.pending_invitation_id = ANY(v_pending_invitation_ids)'
    );
  });

  it('sorts and hydrates in PostgreSQL after bounding the ordinary page', () => {
    expect(migration).toContain('public.profiles AS assignee');
    expect(migration).toContain('LEFT JOIN LATERAL');
    expect(migration).toContain('MIN(tag.name) AS value');
    expect(migration).toContain('custom_sort_value::NUMERIC');
    expect(
      migration.match(/custom_sort_value IS NULL THEN NULL/g)
    ).toHaveLength(2);
    expect(migration).toContain('NULLS LAST');
    expect(migration).toContain('page_rows AS MATERIALIZED');
    expect(migration).toContain('LIMIT p_page_size');
    expect(migration).toContain('page_tags AS MATERIALIZED');
    expect(migration).toContain('page_custom_values AS MATERIALIZED');
    expect(migration).toContain("'quickFilterCounts'");
    expect(migration).toContain("'customValues'");
    expect(migration).toContain("'tags'");
  });

  it('keeps child-table reads selected-account scoped without broad modify policies', () => {
    expect(migration).toContain(
      'SELECT private.authorized_selected_account_id()'
    );
    expect(migration).toContain('CREATE POLICY contact_tags_insert');
    expect(migration).toContain('CREATE POLICY contact_tags_update');
    expect(migration).toContain('CREATE POLICY contact_tags_delete');
    expect(migration).toContain('CREATE POLICY contact_custom_values_insert');
    expect(migration).toContain('CREATE POLICY contact_custom_values_update');
    expect(migration).toContain('CREATE POLICY contact_custom_values_delete');
    expect(migration).not.toMatch(
      /CREATE POLICY contact_(?:tags|custom_values)_modify[\s\S]*?FOR ALL/
    );
  });
});

describe('lead page query-count regression contract', () => {
  it('has no exact PostgREST count, resolver fan-out, or full-id client sort', () => {
    const forbidden = [
      "count: 'exact'",
      'count: "exact"',
      'fetchQuickFilterCounts',
      'resolveContactIdFilter',
      'resolveTagContactIds',
      'resolveCustomValueContactIds',
      'sortedIds',
      'compareCustomValues',
      'clientSort',
    ];
    const regressionsIn = (source: string) =>
      forbidden.filter((pattern) => source.includes(pattern));

    expect(
      regressionsIn(
        "fetchQuickFilterCounts(); resolveContactIdFilter(); const clientSort = sortedIds; select('*', { count: 'exact' });"
      )
    ).toEqual([
      "count: 'exact'",
      'fetchQuickFilterCounts',
      'resolveContactIdFilter',
      'sortedIds',
      'clientSort',
    ]);
    expect(regressionsIn(page)).toEqual([]);
  });

  it('uses one coordinated RPC path for the active table or board', () => {
    const listingBlock = page.slice(
      page.indexOf('const fetchListing = useCallback'),
      page.indexOf('/** Refresh whichever views hold data')
    );
    expect(
      listingBlock.match(/listingCoordinatorRef\.current!\.load/g)
    ).toHaveLength(1);
    expect(listingBlock).not.toContain(".from('");
    expect(listingBlock).not.toContain('.select(');
    expect(page).toContain("const mode = view === 'board' ? 'board' : 'table'");
    expect(page).toContain("mode === 'board' ? LEAD_BOARD_LIMIT : pageSize");
  });

  it('reuses the same SQL filter contract for select-all and export', () => {
    expect(page).toContain(
      "function actionListingInput(mode: 'ids' | 'export')"
    );
    expect(page.match(/loadLeadListingSnapshot\(/g)).toHaveLength(2);
    expect(page).toContain("const input = actionListingInput('ids')");
    expect(page).toContain("const input = actionListingInput('export')");
  });
});
