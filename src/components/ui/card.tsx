import * as React from "react"

import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        // min-h-7 + content-center: the header reserves the height of a
        // header action (every one is 28px — Button size="sm" h-7 /
        // size="icon-sm" size-7) whether or not the card HAS one, so a card
        // with actions and a card without (e.g. Notes) have identical header
        // height and identical space before their content. Without it the
        // header is content-sized, so an action-bearing header ran 6px taller
        // than a bare title and the gap to CardContent visibly jumped between
        // sibling cards. content-center keeps the title optically centred in
        // that reserved row; it's a no-op once a description makes the header
        // taller than the minimum.
        //
        // The action only spans two rows when there IS a second row to span.
        // A blanket row-span-2 on CardAction invents an implicit row in a
        // description-less header, and the grid then distributes the action's
        // 28px across both tracks (≈25px + gap + 3px) — so the header grew
        // taller AND the title landed at a different offset than in a header
        // with no action at all. Scoping the span here keeps a description-less
        // header a single 28px row in both states.
        "group/card-header @container/card-header grid min-h-7 auto-rows-min content-center items-center gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] has-data-[slot=card-description]:[&>[data-slot=card-action]]:row-span-2 [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        // self-center (not self-start): the action sits on the title's optical
        // centre line instead of hanging off the top of it. The row-span-2 (to
        // clear a description) is applied by CardHeader, and only when a
        // description exists — see the note there.
        "col-start-2 row-start-1 self-center justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
