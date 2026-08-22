import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  diagnoseClaimedMetaPage,
  retainMetaPageHealthResult,
  type ClaimedMetaPage,
} from '@/lib/meta/page-health-recovery';

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
    const { accountId } = await requireSettingsAccess();
    const { config_id: configId } = (await request.json()) as {
      config_id?: string;
    };
    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: owned, error: lookupError } = await admin
      .from('meta_page_config')
      .select('id')
      .eq('id', configId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (lookupError || !owned) {
      return NextResponse.json(
        { error: 'Page not connected' },
        { status: 404 }
      );
    }

    const owner = randomUUID();
    const { data, error: claimError } = await admin.rpc(
      'claim_meta_page_health_batch',
      {
        p_health_owner: owner,
        p_limit: 1,
        p_lease_seconds: 300,
        p_force_config_id: configId,
      }
    );
    if (claimError) {
      return NextResponse.json(
        { error: 'Health check could not start' },
        { status: 500 }
      );
    }
    const row = (Array.isArray(data) ? data[0] : null) as
      ClaimedMetaPage | undefined;
    if (!row || row.account_id !== accountId || row.config_id !== configId) {
      return NextResponse.json(
        { error: 'A health check is already in progress' },
        { status: 409 }
      );
    }

    const result = await diagnoseClaimedMetaPage(row);
    const retained = await retainMetaPageHealthResult({
      admin,
      row,
      owner,
      result,
    });
    if (!retained) {
      return NextResponse.json(
        { error: 'The connection changed during the health check' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      kind: result.kind,
      code: result.code,
      message: result.message,
      resolution: result.resolution,
      human_action: result.humanAction,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
