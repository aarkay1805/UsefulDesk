"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Size + fade collapse, driven by an `open` boolean. Mounts/unmounts its
 * children through `AnimatePresence`, animating one axis `0 ↔ auto`. Use it
 * anywhere a section reveals/hides in place (bulk toolbars, inline panels,
 * side-docked panels, expanding detail rows) instead of hand-rolling a
 * `grid-rows-[0fr↔1fr]` / `max-h-0` CSS trick.
 *
 * `axis="height"` (default) reveals vertically; `axis="width"` reveals
 * horizontally (e.g. a panel docked beside a flex sibling — the sibling
 * reflows into the freed space with **no transform**, so it's safe next to
 * `position: sticky` content). Give the child a fixed size on the animated
 * axis; `overflow: hidden` clips it while the wrapper grows.
 *
 * Because the content unmounts when closed, the surrounding flex/grid gap
 * closes on its own — no negative-margin hacks. Freeze any content that must
 * survive the exit (e.g. a selection count) in the caller, not here.
 */
export function Collapse({
  open,
  children,
  className,
  axis = "height",
  duration = 0.28,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  axis?: "height" | "width";
  duration?: number;
}) {
  const closed = axis === "width" ? { width: 0, opacity: 0 } : { height: 0, opacity: 0 };
  const openState =
    axis === "width" ? { width: "auto", opacity: 1 } : { height: "auto", opacity: 1 };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          initial={closed}
          animate={openState}
          exit={closed}
          transition={{ duration, ease: [0.4, 0, 0.2, 1] }}
          style={{ overflow: "hidden" }}
          className={cn("shrink-0", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
