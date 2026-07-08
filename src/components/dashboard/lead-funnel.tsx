"use client"

import Link from 'next/link'
import { Filter } from 'lucide-react'
import type { LeadFunnelData } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface LeadFunnelProps {
  data: LeadFunnelData | null
  loading: boolean
}

// Lead funnel — the PRD's reporting layer, kept to the numbers an
// owner acts on: how many leads sit in each status (and for how
// long), how many converted this month, and which sources actually
// produce members (not just form fills).
export function LeadFunnel({ data, loading }: LeadFunnelProps) {
  const maxCount = data ? Math.max(1, ...data.stages.map((s) => s.count)) : 1

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Lead Funnel</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Where leads sit, how long they&apos;ve sat there, and what converts
          </p>
        </div>
        <Link
          href="/leads"
          className="text-xs font-medium text-primary-text hover:text-primary-text/80"
        >
          Open Leads →
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
                  <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                    {s.label}
                  </span>
                  <div className="h-5 min-w-0 flex-1 rounded bg-muted/60">
                    <div
                      className="flex h-5 items-center rounded px-1.5"
                      style={{
                        width: `${Math.max(4, (s.count / maxCount) * 100)}%`,
                        backgroundColor: s.color + '33',
                      }}
                    >
                      <span
                        className="tinted-text text-[11px] font-semibold tabular-nums"
                        style={{ '--badge-tint': s.color } as React.CSSProperties}
                      >
                        {s.count}
                      </span>
                    </div>
                  </div>
                  <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {s.count > 0 && s.avgDays != null
                      ? `~${s.avgDays}d in stage`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Conversion tiles + source performance */}
          <div className="space-y-4 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Converted this month
                </p>
                <p className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">
                  {data.convertedThisMonth.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Lead → member (all time)
                </p>
                <p className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">
                  {data.conversionRate == null
                    ? '—'
                    : `${Math.round(data.conversionRate * 100)}%`}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Source performance
              </p>
              {data.topSources.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No sources recorded yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topSources.map((s) => (
                    <li
                      key={s.key}
                      className="flex items-center gap-3 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {s.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {s.members}/{s.members + s.leads}
                      </span>
                      <span className="w-10 text-right font-medium text-foreground tabular-nums">
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
  )
}
