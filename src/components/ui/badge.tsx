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
        link: "text-primary-text underline-offset-4 hover:underline",
        // Tinted status pills — the canonical look for statuses across
        // the app (members renewals, leads, broadcasts, flows). Fill-only,
        // matching the upstream `destructive` recipe (tinted bg, no border).
        // Text shade is mode-aware: the -400s only clear WCAG 4.5:1 on
        // dark surfaces; light mode needs the -700s over the same tint.
        success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        danger: "bg-red-500/10 text-red-700 dark:text-red-400",
        warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        violet: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
        // Neutral slate pill (admin-made tags, counts): multiply lets the
        // surface underneath influence the fill, so a neutral counter stays
        // distinct on tinted controls. Dark mode keeps normal compositing —
        // multiplying against a dark surface would erase its contrast.
        neutral:
          "bg-slate-500/10 text-slate-600 mix-blend-multiply dark:text-slate-400 dark:mix-blend-normal",
        // Colour-free variant used internally when the `color` prop is
        // set: `.badge-tinted` (globals.css, components layer) supplies
        // bg + text, so the variant must not emit colour utilities —
        // they'd win the cascade and paint the pill solid primary.
        tinted: "",
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
     * variants — 10% background — with a mode-aware text colour derived
     * from the hex via `.badge-tinted` (globals.css): lightened in dark
     * mode, darkened in light mode, so any stored hex stays ≥4.5:1.
     */
    color?: string;
  }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        // A hex `color` replaces the variant's colours entirely — route
        // through the colour-free `tinted` variant so utilities like
        // `bg-primary` can't out-cascade the `.badge-tinted` recipe.
        className: cn(
          badgeVariants({ variant: color ? "tinted" : variant }),
          color && "badge-tinted",
          className
        ),
        style: color
          ? ({ "--badge-tint": color, ...style } as React.CSSProperties)
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
