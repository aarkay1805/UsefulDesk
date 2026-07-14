import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  /** Minimal stub: no existing contact, capture whatever gets inserted. */
  function stubDb() {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        // findExistingContact: .select().eq().like() → no candidates
        select: () => ({
          eq: () => ({ like: async () => ({ data: [], error: null }) }),
        }),
        insert: (payload: Record<string, unknown>) => {
          inserted.push(payload);
          return {
            select: () => ({
              single: async () => ({ data: { id: 'contact-1' }, error: null }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;
    return { db, inserted };
  }

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });

  it("defaults received_via to 'api' when the caller doesn't say", async () => {
    // Regression guard: migration 064 added a `receivedVia` param for the
    // capture form and the Meta webhook. The public API (this helper's
    // original caller) passes nothing and MUST keep landing as 'api' —
    // silently reclassifying every API-created lead would corrupt the
    // gym's acquisition reporting.
    const { db, inserted } = stubDb();
    const result = await findOrCreateContact(db, 'acc', 'user', {
      phone: '+919876543210',
    });

    expect(result).toEqual({ id: 'contact-1', created: true });
    expect(inserted[0]).toMatchObject({
      account_id: 'acc',
      user_id: 'user',
      phone: '919876543210',
      received_via: 'api',
      source: null,
    });
  });

  it("passes 'form' and 'meta' origins through with their source", async () => {
    const form = stubDb();
    await findOrCreateContact(form.db, 'acc', 'user', {
      phone: '+919876543210',
      receivedVia: 'form',
      source: 'instagram',
    });
    expect(form.inserted[0]).toMatchObject({
      received_via: 'form',
      source: 'instagram',
    });

    const meta = stubDb();
    await findOrCreateContact(meta.db, 'acc', 'user', {
      phone: '+919876543210',
      receivedVia: 'meta',
      source: 'facebook',
    });
    expect(meta.inserted[0]).toMatchObject({
      received_via: 'meta',
      source: 'facebook',
    });
  });

  it('never sets assigned_to — an auto-captured lead lands unassigned', async () => {
    // Setting it would fire notify_lead_assigned (047) at a teammate who
    // never agreed to own the lead, and there is no round-robin here to
    // pick one fairly. The team assigns via request_lead_assignment (052).
    const { db, inserted } = stubDb();
    await findOrCreateContact(db, 'acc', 'user', {
      phone: '+919876543210',
      receivedVia: 'form',
    });
    expect(inserted[0]).not.toHaveProperty('assigned_to');
  });
});
