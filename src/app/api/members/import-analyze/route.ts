import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { generateReply } from '@/lib/ai/generate';
import { loadAiConfig } from '@/lib/ai/config';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  MIGRATION_TARGETS,
  type MemberMigrationRecipe,
  suggestMemberMigrationRecipe,
  validateMemberMigrationRecipe,
} from '@/lib/memberships/migration-recipe';

const INFERRED_TYPES = [
  'text',
  'number',
  'date',
  'email',
  'phone',
  'url',
] as const;
const FORMAT_NAMES = [...INFERRED_TYPES, 'blank'] as const;
const MAX_HEADERS = 100;
const MAX_ROWS = 100000;

type InferredType = (typeof INFERRED_TYPES)[number];
type FormatName = (typeof FORMAT_NAMES)[number];

export interface MemberImportAnalysisRequest {
  headers: string[];
  rowCount: number;
  inferredTypes: Record<string, InferredType>;
  blankCounts: Record<string, number>;
  distinctCounts: Record<string, number>;
  formatStatistics: Record<string, Partial<Record<FormatName, number>>>;
}

export interface MemberImportAnalysisResponse {
  configured: boolean;
  /** The deterministic local recipe. This remains authoritative. */
  recipe: MemberMigrationRecipe;
  /** A validated, optional provider suggestion for an explicit client opt-in. */
  suggestion?: MemberMigrationRecipe;
  warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedCount(value: unknown, rowCount: number): value is number {
  return (
    Number.isInteger(value) &&
    typeof value === 'number' &&
    value >= 0 &&
    value <= rowCount
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validateAnalysisRequest(
  value: unknown
): MemberImportAnalysisRequest | null {
  if (!isRecord(value)) return null;
  const allowedKeys = [
    'headers',
    'rowCount',
    'inferredTypes',
    'blankCounts',
    'distinctCounts',
    'formatStatistics',
  ];
  if (!hasOnlyKeys(value, allowedKeys)) return null;
  const headers = value.headers;
  const rowCount = value.rowCount;
  if (
    !Array.isArray(headers) ||
    headers.length === 0 ||
    headers.length > MAX_HEADERS ||
    headers.some(
      (header) =>
        typeof header !== 'string' || header.length === 0 || header.length > 120
    ) ||
    new Set(headers).size !== headers.length ||
    !isBoundedCount(rowCount, MAX_ROWS) ||
    !isRecord(value.inferredTypes) ||
    !isRecord(value.blankCounts) ||
    !isRecord(value.distinctCounts) ||
    !isRecord(value.formatStatistics)
  ) {
    return null;
  }

  const records = [
    value.inferredTypes,
    value.blankCounts,
    value.distinctCounts,
    value.formatStatistics,
  ];
  if (
    records.some(
      (record) =>
        Object.keys(record).length !== headers.length ||
        !headers.every((header) => Object.hasOwn(record, header))
    )
  ) {
    return null;
  }

  const inferredTypes: Record<string, InferredType> = {};
  const blankCounts: Record<string, number> = {};
  const distinctCounts: Record<string, number> = {};
  const formatStatistics: Record<
    string,
    Partial<Record<FormatName, number>>
  > = {};
  for (const header of headers) {
    const inferredType = value.inferredTypes[header];
    if (!INFERRED_TYPES.includes(inferredType as InferredType)) return null;
    const blanks = value.blankCounts[header];
    const distinct = value.distinctCounts[header];
    if (
      !isBoundedCount(blanks, rowCount) ||
      !isBoundedCount(distinct, rowCount - blanks)
    ) {
      return null;
    }
    const stats = value.formatStatistics[header];
    if (
      !isRecord(stats) ||
      !hasOnlyKeys(stats, FORMAT_NAMES) ||
      Object.values(stats).some((count) => !isBoundedCount(count, rowCount))
    ) {
      return null;
    }
    inferredTypes[header] = inferredType as InferredType;
    blankCounts[header] = blanks;
    distinctCounts[header] = distinct;
    formatStatistics[header] = stats as Partial<Record<FormatName, number>>;
  }

  return {
    headers,
    rowCount,
    inferredTypes,
    blankCounts,
    distinctCounts,
    formatStatistics,
  };
}

function providerSuggestion(
  value: unknown,
  fallback: MemberMigrationRecipe,
  headers: string[]
): MemberMigrationRecipe | null {
  const validation = validateMemberMigrationRecipe(value, headers);
  if (!validation.ok) return null;

  // Provider-authored prose and confidence are never authoritative. Only the
  // validated mappings and operation switches can be surfaced as a suggestion.
  return {
    ...fallback,
    mappings: validation.recipe.mappings,
    excludeSummaryRows: validation.recipe.excludeSummaryRows,
    identityColumn: validation.recipe.identityColumn,
    latestByDateColumn: validation.recipe.latestByDateColumn,
    splitPlanDuration: validation.recipe.splitPlanDuration,
    explicitEndDateWins: validation.recipe.explicitEndDateWins,
    money: validation.recipe.money,
    legacyId: validation.recipe.legacyId,
  };
}

function fallbackResponse(
  configured: boolean,
  recipe: MemberMigrationRecipe,
  warning?: string
): NextResponse<MemberImportAnalysisResponse> {
  return NextResponse.json({
    configured,
    recipe,
    ...(warning ? { warning } : {}),
  });
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(
      `member-import-analyze:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const analysis = validateAnalysisRequest(body);
    if (!analysis) {
      return NextResponse.json(
        { error: 'Invalid file summary.' },
        { status: 400 }
      );
    }
    const fallback = suggestMemberMigrationRecipe(analysis.headers);
    const config = await loadAiConfig(supabase, accountId);
    if (!config) {
      return fallbackResponse(false, fallback);
    }
    let result;
    try {
      result = await generateReply({
        config,
        systemPrompt: `Return only one JSON object. Suggest only safe member CSV mappings and allowlisted recipe operations from this aggregate-only summary. Never output code, SQL, regex, values, names, phones, legacy IDs, notes, or financial amounts. Allowed targets: ${MIGRATION_TARGETS.join(', ')}. Preserve this exact object shape and enum values: ${JSON.stringify(fallback)}. Use exact source header strings. INACTIVE with a past explicit end date means expired and must remain stored active. Explicit end date wins. Latest means greatest parsed start date within identity group. Payments with inconsistent fee/paid/balance must be reviewed, not invented.`,
        messages: [{ role: 'user', content: JSON.stringify(analysis) }],
      });
    } catch {
      return fallbackResponse(
        true,
        fallback,
        'AI is unavailable, so the safe local interpretation is shown instead.'
      );
    }
    const text = result.text.replace(/^```json\s*|\s*```$/g, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return fallbackResponse(
        true,
        fallback,
        'AI returned an unreadable suggestion, so the safe local interpretation is shown instead.'
      );
    }
    const suggestion = providerSuggestion(parsed, fallback, analysis.headers);
    if (!suggestion) {
      return fallbackResponse(
        true,
        fallback,
        'AI returned an unsafe suggestion, so the safe local interpretation is shown instead.'
      );
    }
    return NextResponse.json({
      configured: true,
      recipe: fallback,
      suggestion,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
