import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        // Tinted status pills — the canonical look for statuses across
        // the app (members renewals, leads, broadcasts, flows). Fill-only,
        // matching the upstream `destructive` recipe (tinted bg, no border).
        success: "bg-emerald-500/10 text-emerald-400",
        danger: "bg-red-500/10 text-red-400",
        warning: "bg-amber-500/10 text-amber-400",
        info: "bg-sky-500/10 text-sky-400",
        violet: "bg-violet-500/10 text-violet-400",
        // Neutral slate pill (admin-made tags, counts): the fill-only
        // tint recipe in slate — matches a #64748b colour-prop status
        // badge, so slate reads as "neutral" across statuses and tags.
        neutral: "bg-slate-500/10 text-slate-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  color,
  style,
  render,
  ...props
}: useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /**
     * Dynamic tint from a hex colour (e.g. a lead status colour stored
     * in the DB). Applies the same fill-only recipe as the tinted
     * variants: 10% background, full-strength text. Overrides the
     * variant's colours via inline style.
     */
    color?: string;
  }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
        style: color
          ? {
              backgroundColor: `${color}1a`,
              color,
              ...style,
            }
          : style,
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
