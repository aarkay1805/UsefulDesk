"use client";

import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Snappy, not floaty — the house spring for list add/remove + reflow.
const LIST_SPRING = {
  type: "spring",
  stiffness: 500,
  damping: 40,
  mass: 0.6,
} as const;

/**
 * Wrap a mapped collection so items animate in on add, out on remove, and
 * slide (FLIP) to their new slot when the list reorders. Place it *directly*
 * around the `.map(...)`; each mapped child must be a {@link MotionListItem}
 * (or another `motion.*` with `layout`) carrying a stable `key`.
 *
 * `mode="popLayout"` pops an exiting item out of flow so the survivors reflow
 * immediately instead of waiting for the exit to finish. `initial={false}`
 * skips the entrance animation on first paint (no cascade when the list is
 * already populated on mount).
 */
export function MotionList({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {children}
    </AnimatePresence>
  );
}

/** One animated row/card inside a {@link MotionList}. */
export function MotionListItem({
  children,
  className,
  ...props
}: HTMLMotionProps<"div"> & { children: ReactNode }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={LIST_SPRING}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}
