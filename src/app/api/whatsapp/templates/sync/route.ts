import { NextResponse } from 'next/server';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import {
  buildMissingProviderTemplateUpdate,
  buildMissingProviderTemplateStateUpdate,
  META_TEMPLATE_SYNC_FIELDS,
  buildSyncedTemplateRow,
  findMissingProviderTemplates,
  findUnsafeMissingReconciliationIds,
  normalizeProviderSyncGeneration,
  providerSyncCasFilter,
  type MetaTemplate,
} from '@/lib/whatsapp/template-sync';

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Local drafts (no Meta id) are untouched. Provider-backed rows absent from a
 * complete Meta snapshot are retained, marked DISABLED, and labelled through
 * provider_missing_since so cached approval can never remain sendable.
 */

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export async function POST() {
  let ctx;
  try {
    ctx = await requireSettingsAccess();
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const { supabase, accountId, userId } = ctx;
    const syncStartedAt = new Date().toISOString();

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 }
      );
    }

    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 }
      );
    }

    const accessToken = decrypt(config.access_token);

    const { data: rawSyncGeneration, error: syncGenerationError } =
      await supabase.rpc('next_meta_template_sync_generation');
    const syncGeneration = normalizeProviderSyncGeneration(rawSyncGeneration);
    if (syncGenerationError || syncGeneration === null) {
      return NextResponse.json(
        {
          error:
            syncGenerationError?.message ??
            'Could not allocate a Meta template sync generation.',
        },
        { status: 500 }
      );
    }

    const metaTemplates: MetaTemplate[] = [];
    let nextUrl: string | null =
      `${META_API_BASE}/${config.waba_id}/message_templates?limit=100&fields=${META_TEMPLATE_SYNC_FIELDS}`;
    const PAGE_CAP = 20;
    let pageCount = 0;

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++;
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`;
        try {
          const body = await metaRes.json();
          if (body?.error?.message) metaErr = body.error.message;
        } catch {
          // response wasn't JSON — keep the fallback
        }
        return NextResponse.json({ error: metaErr }, { status: 502 });
      }

      const metaBody: {
        data?: MetaTemplate[];
        paging?: { next?: string };
      } = await metaRes.json();
      if (metaBody.data) metaTemplates.push(...metaBody.data);
      nextUrl = metaBody.paging?.next ?? null;
    }

    let inserted = 0;
    let updated = 0;
    let missing = 0;
    let newlyMissing = 0;
    const errors: { name: string; language: string; message: string }[] = [];

    for (const t of metaTemplates) {
      const row = buildSyncedTemplateRow(
        t,
        accountId,
        userId,
        syncGeneration,
        syncStartedAt
      );

      const { data: existing, error: lookupErr } = await supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', t.name)
        .eq('language', t.language)
        .maybeSingle();

      if (lookupErr) {
        errors.push({
          name: t.name,
          language: t.language,
          message: lookupErr.message,
        });
        continue;
      }

      if (existing?.id) {
        const { data: changed, error: updErr } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
          .or(providerSyncCasFilter(syncGeneration))
          .select('id');
        if (updErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: updErr.message,
          });
        } else if (changed?.length) {
          updated++;
        }
      } else {
        const { error: insErr } = await supabase
          .from('message_templates')
          .insert(row);
        if (insErr) {
          if (isUniqueViolation(insErr)) {
            const { data: racedRow, error: racedLookupError } = await supabase
              .from('message_templates')
              .select('id')
              .eq('account_id', accountId)
              .eq('name', t.name)
              .eq('language', t.language)
              .maybeSingle();

            if (racedLookupError || !racedRow?.id) {
              errors.push({
                name: t.name,
                language: t.language,
                message:
                  racedLookupError?.message ??
                  'Template was inserted concurrently but could not be reloaded.',
              });
              continue;
            }

            const { data: changed, error: racedUpdateError } = await supabase
              .from('message_templates')
              .update(row)
              .eq('id', racedRow.id)
              .or(providerSyncCasFilter(syncGeneration))
              .select('id');

            if (racedUpdateError) {
              errors.push({
                name: t.name,
                language: t.language,
                message: racedUpdateError.message,
              });
            } else if (changed?.length) {
              updated++;
            }
          } else {
            errors.push({
              name: t.name,
              language: t.language,
              message: insErr.message,
            });
          }
        } else {
          inserted++;
        }
      }
    }

    const snapshotComplete = nextUrl === null;
    if (snapshotComplete) {
      const { data: localProviderTemplates, error: localLookupError } =
        await supabase
          .from('message_templates')
          .select(
            'id, name, language, meta_template_id, provider_missing_since'
          )
          .eq('account_id', accountId)
          .not('meta_template_id', 'is', null);

      if (localLookupError) {
        errors.push({
          name: 'Provider reconciliation',
          language: 'all',
          message: localLookupError.message,
        });
      } else {
        const missingTemplates = findMissingProviderTemplates(
          localProviderTemplates ?? [],
          metaTemplates,
          true
        );
        const newlyMissingTemplates = missingTemplates.filter(
          (template) => !template.provider_missing_since
        );
        const alreadyMissingTemplates = missingTemplates.filter(
          (template) => template.provider_missing_since
        );
        const detectedAt = new Date().toISOString();
        const missingStateUpdate = buildMissingProviderTemplateStateUpdate(
          detectedAt,
          syncGeneration
        );

        for (
          let index = 0;
          index < newlyMissingTemplates.length;
          index += 100
        ) {
          const batch = newlyMissingTemplates.slice(index, index + 100);
          const { data: marked, error: markError } = await supabase
            .from('message_templates')
            .update(
              buildMissingProviderTemplateUpdate(detectedAt, syncGeneration)
            )
            .eq('account_id', accountId)
            .in(
              'id',
              batch.map((template) => template.id)
            )
            .is('provider_missing_since', null)
            .or(providerSyncCasFilter(syncGeneration))
            .select('id');

          if (markError) {
            errors.push({
              name: 'Provider reconciliation',
              language: 'all',
              message: markError.message,
            });
            continue;
          }

          const markedCount = marked?.length ?? 0;
          newlyMissing += markedCount;
        }

        for (
          let index = 0;
          index < alreadyMissingTemplates.length;
          index += 100
        ) {
          const batch = alreadyMissingTemplates.slice(index, index + 100);
          const { error: markError } = await supabase
            .from('message_templates')
            .update(missingStateUpdate)
            .eq('account_id', accountId)
            .in(
              'id',
              batch.map((template) => template.id)
            )
            .not('provider_missing_since', 'is', null)
            .or(providerSyncCasFilter(syncGeneration))
            .select('id');

          if (markError) {
            errors.push({
              name: 'Provider reconciliation',
              language: 'all',
              message: markError.message,
            });
            continue;
          }
        }

        if (missingTemplates.length > 0) {
          const { data: reconciledRows, error: verifyError } = await supabase
            .from('message_templates')
            .select(
              'id, status, provider_missing_since, provider_sync_generation'
            )
            .eq('account_id', accountId)
            .in(
              'id',
              missingTemplates.map((template) => template.id)
            );

          if (verifyError) {
            errors.push({
              name: 'Provider reconciliation verification',
              language: 'all',
              message: verifyError.message,
            });
          } else {
            const unsafeIds = findUnsafeMissingReconciliationIds(
              reconciledRows ?? [],
              syncGeneration
            );
            if (unsafeIds.length > 0) {
              errors.push({
                name: 'Provider reconciliation verification',
                language: 'all',
                message: `${unsafeIds.length} missing template${unsafeIds.length === 1 ? '' : 's'} remained in stale provider state.`,
              });
            }
            missing = (reconciledRows ?? []).filter(
              (row) => row.provider_missing_since && row.status !== 'APPROVED'
            ).length;
          }
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      missing,
      newly_missing: newlyMissing,
      errors,
      truncated: !snapshotComplete,
    });
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 }
    );
  }
}
