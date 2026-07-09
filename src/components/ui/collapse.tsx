"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Height + fade collapse, driven by an `open` boolean. Mounts/unmounts its
 * children through `AnimatePresence`, animating `height: 0 ↔ auto`. Use it
 * anywhere a section reveals/hides in place (bulk toolbars, inline panels,
 * expanding detail rows) instead of hand-rolling a `grid-rows-[0fr↔1fr]` +
 * `overflow-hidden` CSS trick.
 *
 * Because the content unmounts when closed, the surrounding flex/grid gap
 * closes on its own — no negative-margin hacks. Freeze any content that must
 * survive the exit (e.g. a selection count) in the caller, not here.
 */
export function Collapse({
  open,
  children,
  className,
  duration = 0.28,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  duration?: number;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
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
