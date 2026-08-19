'use client';

import Link from 'next/link';
import { Filter } from 'lucide-react';
import { useLocale } from '@/hooks/use-locale';
import type { LeadFunnelData } from '@/lib/dashboard/types';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface LeadFunnelProps {
  data: LeadFunnelData | null;
  loading: boolean;
}

// Lead funnel — the PRD's reporting layer, kept to the numbers an
// owner acts on: how many leads sit in each status (and for how
// long), how many converted this month, and which sources actually
// produce members (not just form fills).
export function LeadFunnel({ data, loading }: LeadFunnelProps) {
  const { fmt } = useLocale();
  const maxCount = data ? Math.max(1, ...data.stages.map((s) => s.count)) : 1;

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            Leads by stage
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            See how many leads are in each stage and how long they stay
          </p>
        </div>
        <Link
          data-slot="button"
          href="/leads"
          className={buttonVariants({ variant: 'link', size: 'xs' })}
        >
          See all leads
        </Link>
      </header>

      {loading || !data ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : data.totalLeads === 0 && data.convertedThisMonth === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={Filter}
            title="No leads yet"
            hint="Add or import leads to see stage and conversion numbers here."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-5">
          {/* Stage bars */}
          <div className="lg:col-span-3">
            <ul className="space-y-2.5">
              {data.stages.map((s) => (
                <li key={s.key} className="flex items-center gap-3">
                  <span className="text-muted-foreground w-28 shrink-0 truncate text-xs">
                    {s.label}
                  </span>
                  <div className="bg-muted/60 h-5 min-w-0 flex-1 rounded">
                    <div
                      className="flex h-5 items-center rounded px-1.5"
                      style={{
                        width: `${Math.max(4, (s.count / maxCount) * 100)}%`,
                        backgroundColor: s.color + '33',
                      }}
                    >
                      <span
                        className="tinted-text text-[11px] font-semibold tabular-nums"
                        style={
                          { '--badge-tint': s.color } as React.CSSProperties
                        }
                      >
                        {s.count}
                      </span>
                    </div>
                  </div>
                  <span className="text-muted-foreground w-24 shrink-0 text-right text-[11px] whitespace-nowrap tabular-nums">
                    {s.count > 0 && s.avgDays != null
                      ? `${s.avgDays} days here`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Conversion tiles + source performance */}
          <div className="space-y-4 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="border-border bg-muted/30 rounded-lg border px-3 py-2.5">
                <p className="text-muted-foreground text-[11px]">
                  Joined this month
                </p>
                <p className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">
                  {fmt.number(data.convertedThisMonth)}
                </p>
              </div>
              <div className="border-border bg-muted/30 rounded-lg border px-3 py-2.5">
                <p className="text-muted-foreground text-[11px]">
                  Leads who joined
                </p>
                <p className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">
                  {data.conversionRate == null
                    ? '—'
                    : `${Math.round(data.conversionRate * 100)}%`}
                </p>
              </div>
            </div>

            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                Lead source results
              </p>
              {data.topSources.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No sources recorded yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topSources.map((s) => (
                    <li key={s.key} className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">
                        {s.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {s.members}/{s.members + s.leads}
                      </span>
                      <span className="text-foreground w-10 text-right font-medium tabular-nums">
                        {s.rate == null ? '—' : `${Math.round(s.rate * 100)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
