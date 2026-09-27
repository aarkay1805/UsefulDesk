import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text contract for the migration that gave every enquiry read the directory's
// definition: an enquiry has neither a membership nor a service purchase. No
// database is reachable from unit tests, so these pin the predicates, the
// unchanged signatures and grants, and that the Leads listing changed nothing
// but its cohort predicate.
const migrationsDir = join(process.cwd(), 'supabase/migrations');

function migration(name: string): string {
  return readFileSync(join(migrationsDir, name), 'utf8');
}

function latestMigrationContaining(fragment: string): string {
  const name = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => migration(file).includes(fragment))
    .at(-1);
  if (!name) throw new Error(`No migration contains ${fragment}`);
  return migration(name);
}

function block(source: string, from: string, to?: string): string {
  const start = source.indexOf(from);
  const end = to === undefined ? source.length : source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`missing block ${from}`);
  return source.slice(start, end);
}

const current = migration(
  '20260927130000_enquiry_reads_exclude_service_customers.sql'
);
const previousListing = migration(
  '20260829010000_consolidate_leads_listing.sql'
);
const previousAggregates = migration('047_lead_ownership_ops.sql');
const directory = latestMigrationContaining(
  'CREATE OR REPLACE VIEW public.member_customer_directory'
);

const listing = block(
  current,
  'CREATE OR REPLACE FUNCTION public.lead_listing_snapshot(',
  '-- Enquiries by stage:'
);
const stages = block(
  current,
  'CREATE OR REPLACE FUNCTION public.lead_funnel_stats()',
  '-- Enquiries and members per source.'
);
const sources = block(
  current,
  'CREATE OR REPLACE FUNCTION public.lead_source_conversion()'
);

const listingServiceExclusion = [
  '      AND NOT EXISTS (',
  '        SELECT 1',
  '        FROM public.member_services AS service',
  '        WHERE service.account_id = p_account_id',
  '          AND service.contact_id = contact.id',
  '      )',
  '',
].join('\n');

describe('enquiry definition SQL contract', () => {
  it('replaces the three enquiry reads in place and keeps their grants', () => {
    expect(current.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(3);
    expect(current).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(current).not.toContain('DROP FUNCTION');
    for (const signature of [
      'CREATE OR REPLACE FUNCTION public.lead_funnel_stats()\nRETURNS TABLE (lead_status TEXT, lead_count BIGINT, avg_days_in_stage NUMERIC)',
      'CREATE OR REPLACE FUNCTION public.lead_source_conversion()\nRETURNS TABLE (source TEXT, leads BIGINT, members BIGINT)',
    ]) {
      expect(previousAggregates).toContain(signature);
      expect(current).toContain(signature);
    }
    for (const read of [stages, sources]) {
      expect(read).toContain("STABLE\nSECURITY INVOKER\nSET search_path = ''");
    }
    for (const fn of [
      'public.lead_funnel_stats()',
      'public.lead_source_conversion()',
    ]) {
      for (const grant of [
        `REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`,
        `GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`,
      ]) {
        expect(previousAggregates).toContain(grant);
        expect(current).toContain(grant);
      }
      expect(current).toContain(`ALTER FUNCTION ${fn} OWNER TO postgres;`);
    }
  });

  it('changes the Leads listing only by leaving service customers out of its cohort', () => {
    expect(listing).toContain(listingServiceExclusion);
    // Same signature, body, grants, and comment as before, plus one check.
    expect(listing.replace(listingServiceExclusion, '').trimEnd()).toBe(
      block(
        previousListing,
        'CREATE OR REPLACE FUNCTION public.lead_listing_snapshot('
      ).trimEnd()
    );
    // The check sits in the one cohort that the rows, total, board,
    // select-all, export, and every quick-filter count derive from.
    const at = listing.indexOf(listingServiceExclusion);
    expect(at).toBeGreaterThan(
      listing.indexOf('WITH filtered_leads AS MATERIALIZED (')
    );
    expect(at).toBeLessThan(listing.indexOf('active_leads AS MATERIALIZED ('));
  });

  it('counts only enquiries in Enquiries by stage', () => {
    expect(stages).toContain('WHERE NOT EXISTS (');
    expect(stages).toContain('FROM public.memberships AS membership');
    expect(stages).toContain('AND NOT EXISTS (');
    expect(stages).toContain('FROM public.member_services AS service');
    expect(stages).toContain('GROUP BY contact.lead_status');
    // Stage age is unchanged: days since the last stage change, else creation.
    expect(stages).toContain(
      'COALESCE(contact.lead_status_changed_at, contact.created_at)'
    );
    expect(stages).toContain(') / 86400');
  });

  it('keeps source members membership-only while leads leave service customers out', () => {
    const leads = block(sources, 'COUNT(*) FILTER (', ') AS leads,');
    const members = block(sources, ') AS leads,', ') AS members');
    expect(leads).toContain('WHERE NOT EXISTS (');
    expect(leads).toContain('FROM public.memberships AS membership');
    expect(leads).toContain('AND NOT EXISTS (');
    expect(leads).toContain('FROM public.member_services AS service');
    expect(members).toContain('WHERE EXISTS (');
    expect(members).toContain('FROM public.memberships AS membership');
    expect(members).not.toContain('member_services');
    expect(sources).toContain("'unknown'");
  });

  it('leaves out exactly the contacts All members lists', () => {
    // All members admits a contact with a membership or any service row, each
    // joined on account and contact...
    expect(directory).toContain(
      'WHERE membership.id IS NOT NULL OR COALESCE(services.service_count, 0) > 0;'
    );
    expect(directory).toContain('COUNT(service.id)::INTEGER AS service_count');
    expect(directory).toContain('services.account_id = contact.account_id');
    expect(directory).toContain('services.contact_id = contact.id');
    // ...so every enquiry read joins both checks the same way, whatever the
    // service's status.
    expect(listing).toContain('WHERE service.account_id = p_account_id');
    for (const read of [stages, sources]) {
      expect(read).toContain(
        'WHERE membership.account_id = contact.account_id'
      );
      expect(read).toContain('AND membership.contact_id = contact.id');
      expect(read).toContain('WHERE service.account_id = contact.account_id');
      expect(read).toContain('AND service.contact_id = contact.id');
    }
    expect(current).not.toContain('service.status');
  });
});
