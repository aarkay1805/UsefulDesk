import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The floating confirm/dismiss pair shown inside an active inline
 * editor (leads table cells, lead-detail fields). Render inside a
 * `relative` wrapper around the input and give the input enough right
 * padding to clear the pair (`pr-13`).
 *
 * onMouseDown preventDefault keeps the input focused while a button is
 * clicked, so blur-driven dismissal in the host can't fire before the
 * button's onClick.
 */
function InlineEditActions({
  saving,
  onConfirm,
  onDismiss,
}: {
  /** Disables both buttons and swaps the check for a spinner. */
  saving?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const button =
    "flex size-6 shrink-0 items-center justify-center rounded-full bg-card disabled:opacity-50 cursor-pointer";
  return (
    <div className="absolute top-1/2 right-2.5 z-10 flex -translate-y-1/2 items-center gap-0.5">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onConfirm}
        disabled={saving}
        className={cn(button, "text-primary-text hover:bg-primary/10")}
        aria-label="Save"
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDismiss}
        disabled={saving}
        className={cn(button, "text-muted-foreground hover:bg-muted")}
        aria-label="Cancel"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export { InlineEditActions };
