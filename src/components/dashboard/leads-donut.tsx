"use client"

import { Users } from 'lucide-react'
import type { LeadsDonutData } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface LeadsDonutProps {
  data: LeadsDonutData | null
  loading: boolean
}

// Replaces the old pipeline-value donut: the ring now shows the lead
// pool (contacts without a membership) split by lead_status. Counts,
// not currency — leads carry no deal value in the gym model.
export function LeadsDonut({ data, loading }: LeadsDonutProps) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Lead Pool</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Leads by status
        </p>
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.slices.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No leads yet"
            hint="Add or import leads to see the status breakdown here."
          />
        ) : (
          <>
            <Donut data={data} />
            <ul className="mt-5 space-y-2">
              {data.slices.map((s) => (
                <li key={s.key} className="flex items-center gap-3 text-xs">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {s.count} lead{s.count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// SVG ring. 200×200 viewBox, 18px ring width. One <path> per
// status slice, arc from startAngle → endAngle.
// ------------------------------------------------------------
function Donut({ data }: { data: LeadsDonutData }) {
  const size = 200
  const r = 80
  const ringWidth = 18
  const cx = size / 2
  const cy = size / 2

  // Small slices would render as slivers that disappear into stroke
  // rounding. We give each status a floor share purely for rendering,
  // but keep the legend honest with the actual counts.
  const totalRaw = data.total || 1
  const minFrac = 0.02
  const rawShares = data.slices.map((s) => s.count / totalRaw)
  const floored = rawShares.map((x) => Math.max(x, minFrac))
  const floorSum = floored.reduce((a, b) => a + b, 0)
  const shares = floored.map((x) => x / floorSum)

  // Build a cumulative-offset array, then map slices → arc paths. Using
  // a pre-computed offsets array avoids the Next 16 React Compiler's
  // "Cannot reassign variable after render completes" rule.
  const offsets: number[] = [0]
  for (let i = 0; i < shares.length; i++) offsets.push(offsets[i] + shares[i])
  const segments = data.slices.map((s, i) => {
    const start = offsets[i] * Math.PI * 2 - Math.PI / 2
    const end = offsets[i + 1] * Math.PI * 2 - Math.PI / 2
    return { path: arcPath(cx, cy, r, start, end), color: s.color, key: s.key }
  })

  return (
    <div className="flex items-center justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48" role="img" aria-label="Leads by status">
        {/* background ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth={ringWidth} />
        {segments.map((seg) => (
          <path
            key={seg.key}
            d={seg.path}
            fill="none"
            stroke={seg.color}
            strokeWidth={ringWidth}
            strokeLinecap="butt"
          />
        ))}
        {/* center label */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          Leads
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="fill-foreground text-[18px] font-semibold tabular-nums"
        >
          {data.total.toLocaleString()}
        </text>
      </svg>
    </div>
  )
}

function arcPath(cx: number, cy: number, r: number, startRad: number, endRad: number): string {
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = endRad - startRad > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
}
