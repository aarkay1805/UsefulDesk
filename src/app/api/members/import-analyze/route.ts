import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { generateReply } from '@/lib/ai/generate';
import { loadAiConfig } from '@/lib/ai/config';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  MIGRATION_TARGETS,
  suggestMemberMigrationRecipe,
  validateMemberMigrationRecipe,
} from '@/lib/memberships/migration-recipe';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(`member-import-analyze:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const headers = Array.isArray(body?.headers)
      ? body.headers.filter((item: unknown): item is string => typeof item === 'string').slice(0, 100)
      : [];
    if (!headers.length || headers.some((header: string) => header.length > 120)) {
      return NextResponse.json({ error: 'Invalid file summary.' }, { status: 400 });
    }
    const fallback = suggestMemberMigrationRecipe(headers);
    const config = await loadAiConfig(supabase, accountId);
    if (!config) {
      return NextResponse.json({ configured: false, recipe: fallback });
    }
    const safeSummary = {
      headers,
      rowCount: Math.min(Number(body.rowCount) || 0, 100000),
      samples: Array.isArray(body.samples) ? body.samples.slice(0, 100).map((item: unknown) => {
        const sample = item as { header?: unknown; values?: unknown };
        return {
          header: typeof sample.header === 'string' ? sample.header.slice(0, 120) : '',
          values: Array.isArray(sample.values)
            ? sample.values.filter((value): value is string => typeof value === 'string').slice(0, 5).map((value) => value.slice(0, 120))
            : [],
        };
      }) : [],
      explanation: typeof body.explanation === 'string' ? body.explanation.slice(0, 2000) : '',
    };
    const result = await generateReply({
      config,
      systemPrompt: `Return only one JSON object. Propose a safe member CSV migration recipe based on the supplied summary. Never output code, SQL, regex, or unknown fields. Allowed targets: ${MIGRATION_TARGETS.join(', ')}. Preserve this exact object shape and enum values: ${JSON.stringify(fallback)}. Use exact source header strings. INACTIVE with a past explicit end date means expired and must remain stored active. Explicit end date wins. Latest means greatest parsed start date within identity group. Payments with inconsistent fee/paid/balance must be reviewed, not invented.`,
      messages: [{ role: 'user', content: JSON.stringify(safeSummary) }],
    });
    const text = result.text.replace(/^```json\s*|\s*```$/g, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json({
        configured: true,
        recipe: fallback,
        warning: 'AI returned an unreadable suggestion, so the safe local interpretation is shown instead.',
      });
    }
    const validation = validateMemberMigrationRecipe(parsed, headers);
    if (!validation.ok) {
      return NextResponse.json({ configured: true, recipe: fallback, warning: 'AI returned an unsafe suggestion, so the safe local interpretation is shown instead.' });
    }
    return NextResponse.json({ configured: true, recipe: validation.recipe });
  } catch (error) {
    return toErrorResponse(error);
  }
}
