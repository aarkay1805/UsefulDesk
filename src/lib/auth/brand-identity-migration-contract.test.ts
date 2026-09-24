import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260924110000_independent_gym_brand_and_legal_identity.sql'
  ),
  'utf8'
);

function definition(start: string, end: string) {
  return sql.slice(sql.indexOf(start), sql.indexOf(end, sql.indexOf(start)));
}

describe('independent gym brand and legal identity migration', () => {
  it('provisions and completes gym brands without asserting a legal business name', () => {
    const provisioning = definition(
      'CREATE OR REPLACE FUNCTION public.handle_new_user()',
      'ALTER FUNCTION public.handle_new_user()'
    );
    const completion = definition(
      'CREATE OR REPLACE FUNCTION public.complete_organization_name_setup(',
      'ALTER FUNCTION public.complete_organization_name_setup(UUID, TEXT)'
    );
    expect(provisioning).toContain('v_org, v_business_name, NULL, v_currency');
    expect(completion).toContain('UPDATE public.organizations');
    expect(completion).toContain('UPDATE public.accounts');
    expect(completion).not.toContain('legal_name = v_gym_name');
    expect(sql).not.toMatch(
      /UPDATE public\.legal_entities\s+SET legal_name = v_gym_name/
    );
  });

  it('updates only the organization label when its owner edits the brand', () => {
    const brand = definition(
      'CREATE OR REPLACE FUNCTION public.save_organization_brand_name(',
      'ALTER FUNCTION public.save_organization_brand_name(UUID, TEXT)'
    );
    expect(brand).toContain('public.is_organization_owner');
    expect(brand).toMatch(
      /FROM public\.account_memberships membership[\s\S]*?FOR UPDATE;/
    );
    expect(brand).toMatch(
      /FROM public\.organization_memberships membership[\s\S]*?FOR UPDATE;/
    );
    expect(brand).toContain('UPDATE public.organizations');
    expect(brand).not.toContain('UPDATE public.legal_entities');
    expect(brand).not.toContain('UPDATE public.accounts');
    expect(brand).not.toContain('UPDATE public.invoice_profiles');
    expect(brand).toContain("'organization.brand_name_updated'");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.save_organization_brand_name(UUID, TEXT)'
    );
  });

  it('keeps legal-name edits away from the brand and requires legal identity for invoices and messages', () => {
    const legal = definition(
      'CREATE OR REPLACE FUNCTION public.save_legal_business_name(',
      'ALTER FUNCTION public.save_legal_business_name(UUID, TEXT)'
    );
    expect(legal).toContain('UPDATE public.legal_entities');
    expect(legal).not.toContain('UPDATE public.organizations');
    expect(sql).toContain('legal_entity_legal_name TEXT');
    expect(sql).toContain(
      "NULLIF(pg_catalog.btrim(legal_entity.legal_name), '')"
    );
    expect(sql).toContain("NULLIF(pg_catalog.btrim(le.legal_name), '')");
    expect(sql).toContain('OR v_legal_name IS NULL THEN');
    expect(sql).toContain(
      'Set the legal business name before saving Invoice details'
    );
  });
});
