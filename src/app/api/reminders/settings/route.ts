import { NextResponse } from 'next/server';

import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import {
  getReminderRule,
  parseReminderRulePatch,
  REMINDER_RULES,
  reminderTemplateNames,
  ruleSettingsFromRow,
  type ReminderRule,
  type ReminderRuleReadiness,
  type ReminderRuleResponse,
  type ReminderSettingsResponse,
} from '@/lib/reminders/rules';
import {
  evaluateTemplateReadiness,
  type TemplateReadinessRow,
} from '@/lib/whatsapp/template-readiness';

export const runtime = 'nodejs';

const SETTINGS_COLUMNS = Array.from(
  new Set(
    REMINDER_RULES.flatMap((rule) => rule.fields.map((field) => field.column))
  )
)
  .concat('account_id')
  .join(', ');

type TemplateRow = TemplateReadinessRow;

function readinessForRule(
  rule: ReminderRule,
  whatsappConnected: boolean,
  templates: readonly TemplateRow[]
): ReminderRuleReadiness {
  if (!whatsappConnected) {
    return {
      ready: false,
      code: 'whatsapp_not_connected',
      message: 'Connect WhatsApp before turning this message on.',
    };
  }
  for (const contractId of rule.templateContracts) {
    const result = evaluateTemplateReadiness(templates, contractId, 'en_US');
    if (!result.ready) {
      return {
        ready: false,
        code: result.code,
        message: result.message,
        templateContractId: contractId,
      };
    }
  }
  return { ready: true, code: 'ready' };
}

function serialiseRule(
  rule: ReminderRule,
  row: Record<string, unknown> | null,
  whatsappConnected: boolean,
  templates: readonly TemplateRow[]
): ReminderRuleResponse {
  return {
    ...rule,
    settings: ruleSettingsFromRow(rule, row),
    readiness: readinessForRule(rule, whatsappConnected, templates),
  };
}

async function loadReadinessData(
  db: Awaited<ReturnType<typeof requireSettingsAccess>>['supabase'],
  accountId: string
) {
  const names = Array.from(
    new Set(REMINDER_RULES.flatMap(reminderTemplateNames))
  );
  const [configResult, templatesResult] = await Promise.all([
    db
      .from('whatsapp_config')
      .select('status')
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .in('name', names),
  ]);
  if (configResult.error) throw configResult.error;
  if (templatesResult.error) throw templatesResult.error;
  return {
    whatsappConnected: configResult.data?.status === 'connected',
    templates: (templatesResult.data ?? []) as TemplateRow[],
  };
}

export async function GET() {
  try {
    const ctx = await requireSettingsAccess();
    const [settingsResult, readiness] = await Promise.all([
      ctx.supabase
        .from('renewal_reminder_settings')
        .select(SETTINGS_COLUMNS)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      loadReadinessData(ctx.supabase, ctx.accountId),
    ]);
    if (settingsResult.error) throw settingsResult.error;

    const response: ReminderSettingsResponse = {
      whatsappConnected: readiness.whatsappConnected,
      rules: REMINDER_RULES.map((rule) =>
        serialiseRule(
          rule,
          settingsResult.data as unknown as Record<string, unknown> | null,
          readiness.whatsappConnected,
          readiness.templates
        )
      ),
    };
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Expected a rule patch.' },
        { status: 400 }
      );
    }
    const { ruleId, patch } = body as { ruleId?: unknown; patch?: unknown };
    const rule = typeof ruleId === 'string' ? getReminderRule(ruleId) : null;
    if (!rule)
      return NextResponse.json(
        { error: 'Unknown reminder rule.' },
        { status: 400 }
      );
    if (!rule.configurable) {
      return NextResponse.json(
        { error: 'This rule does not have account settings yet.' },
        { status: 409 }
      );
    }
    const parsed = parseReminderRulePatch(rule, patch);
    if (!parsed.ok)
      return NextResponse.json({ error: parsed.error }, { status: 400 });

    const ctx = await requireSettingsAccess();
    const [currentResult, readiness] = await Promise.all([
      ctx.supabase
        .from('renewal_reminder_settings')
        .select(SETTINGS_COLUMNS)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      loadReadinessData(ctx.supabase, ctx.accountId),
    ]);
    if (currentResult.error) throw currentResult.error;

    const current = currentResult.data as unknown as Record<
      string,
      unknown
    > | null;
    const start =
      parsed.value.invoice_collection_send_window_start ??
      current?.invoice_collection_send_window_start ??
      9;
    const end =
      parsed.value.invoice_collection_send_window_end ??
      current?.invoice_collection_send_window_end ??
      19;
    if (typeof start === 'number' && typeof end === 'number' && start > end) {
      return NextResponse.json(
        { error: 'sendWindowStart cannot be after sendWindowEnd' },
        { status: 400 }
      );
    }
    const enabledField = rule.fields.find((field) => field.key === 'enabled');
    const enabling =
      enabledField &&
      parsed.value[enabledField.column] === true &&
      current?.[enabledField.column] !== true;
    const ruleReadiness = readinessForRule(
      rule,
      readiness.whatsappConnected,
      readiness.templates
    );
    if (enabling && !ruleReadiness.ready) {
      return NextResponse.json(
        {
          error: ruleReadiness.message,
          code: ruleReadiness.code,
          templateContractId: ruleReadiness.templateContractId,
        },
        { status: 409 }
      );
    }

    let saved;
    if (current) {
      saved = await ctx.supabase
        .from('renewal_reminder_settings')
        .update(parsed.value)
        .eq('account_id', ctx.accountId)
        .select(SETTINGS_COLUMNS)
        .single();
    } else {
      saved = await ctx.supabase
        .from('renewal_reminder_settings')
        .insert({ account_id: ctx.accountId, ...parsed.value })
        .select(SETTINGS_COLUMNS)
        .single();
      // A first-settings insert can race another narrow PATCH. Retrying as a
      // narrow update preserves the row that won the race and its other rules.
      if (saved.error && saved.error.code === '23505') {
        saved = await ctx.supabase
          .from('renewal_reminder_settings')
          .update(parsed.value)
          .eq('account_id', ctx.accountId)
          .select(SETTINGS_COLUMNS)
          .single();
      }
    }
    const { data, error } = saved;
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23514') {
        const currentReadiness = await loadReadinessData(
          ctx.supabase,
          ctx.accountId
        );
        const refreshed = readinessForRule(
          rule,
          currentReadiness.whatsappConnected,
          currentReadiness.templates
        );
        return NextResponse.json(
          {
            error:
              refreshed.message ??
              'Reminder setup changed before this rule could be enabled.',
            code: refreshed.ready
              ? 'activation_readiness_changed'
              : refreshed.code,
            templateContractId: refreshed.templateContractId,
          },
          { status: 409 }
        );
      }
      if (code === '23503' || code === '23505') {
        return NextResponse.json(
          { error: 'Invalid reminder settings.' },
          { status: 400 }
        );
      }
      if (code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Reminder settings could not be saved.' },
          { status: 403 }
        );
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Reminder settings could not be saved.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      rule: serialiseRule(
        rule,
        data as unknown as Record<string, unknown>,
        readiness.whatsappConnected,
        readiness.templates
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
