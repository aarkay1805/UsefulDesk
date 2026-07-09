"use client";

import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

/**
 * A number that counts up from 0 → `value` the first time it scrolls into
 * view. Drives the text via a ref (no React state per frame → no re-render
 * storm), so it's cheap even in a grid of KPI tiles.
 *
 * Pass `format` to render currency/compact strings — it animates the raw
 * number and formats each frame (e.g. `format={(n) => formatCurrency(n)}`).
 * Honours `prefers-reduced-motion`: snaps straight to the final value.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 0.9,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  // Keep the latest formatter without retriggering the animation each render.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!inView || reduce) {
      el.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = formatRef.current(v);
      },
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  // Static fallback for the first paint / no-JS; the effect takes over on mount.
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
