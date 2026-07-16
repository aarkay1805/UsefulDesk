import { cn } from "@/lib/utils";

interface ProgressProps extends React.ComponentProps<"div"> {
  /** Current value, clamped to [0, max]. */
  value: number;
  /** Upper bound the value is measured against. Defaults to 100. */
  max?: number;
}

/**
 * Determinate progress bar — a muted track with a primary fill.
 * Purely presentational; pass `value`/`max` (e.g. completed steps out
 * of total) and it renders the proportion with progressbar semantics.
 */
function Progress({ value, max = 100, className, ...props }: ProgressProps) {
  const bounded = max > 0 ? Math.min(Math.max(value, 0), max) : 0;
  const percent = max > 0 ? (bounded / max) * 100 : 0;
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={bounded}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-fill"
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export { Progress };
