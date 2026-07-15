/**
 * Ready-made gym message templates — starting points a gym can drop into
 * the New Template form, tweak (name, wording, footer), and submit to Meta.
 *
 * Design goals:
 *  - **Easy Meta approval.** Utility presets read as transactional (tied to
 *    a specific membership / payment / booking event) with no promotional
 *    push, which is what Meta wants for the Utility category. The two
 *    Marketing presets are clearly promotional, so they're labelled as
 *    such — a gym should expect Marketing review + opt-in rules for those.
 *  - **Contiguous {{1}}… variables** with 1:1 sample values, so they pass
 *    `validateTemplatePayload` before ever reaching Meta.
 *  - **Customisable.** Every field is a plausible default, not a mandate;
 *    the gym edits copy/footer to their brand before submitting.
 *
 * `gym_renewal_reminder` is PINNED: its exact name + 4-variable body
 * (name, plan, expiry, fee) is the contract the one-tap Remind button and
 * the renewals cron send against (see RENEWAL_TEMPLATE_NAME). Renaming it
 * breaks that wiring, so the picker locks the name for this one.
 */

import type { TemplateButton } from "@/types";
import { RENEWAL_TEMPLATE_NAME } from "@/lib/memberships/renewal-reminders";

export interface TemplatePreset {
  /** Stable key for React lists + selection. */
  id: string;
  /** Human title shown in the picker card. */
  title: string;
  /** One line: what it's for and when a gym sends it. */
  blurb: string;
  category: "Utility" | "Marketing";
  /** Extra context/approval note shown under the body preview. */
  note?: string;
  /**
   * The renewal template the Remind button + cron depend on. The picker
   * pins it first and locks its name so it stays wired.
   */
  pinned?: boolean;
  /** Values that pre-fill the New Template form. */
  fields: {
    name: string;
    category: "Utility" | "Marketing";
    header_format: "none" | "text";
    header_content?: string;
    header_sample?: string;
    body_text: string;
    /** Exactly one per {{N}} in body_text, in order. */
    body_samples: string[];
    footer_text?: string;
    buttons?: TemplateButton[];
  };
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "renewal_reminder",
    title: "Renewal reminder",
    blurb: "Nudge a member whose plan is about to expire. Powers the one-tap Remind button.",
    category: "Utility",
    pinned: true,
    note: "Keep the name gym_renewal_reminder and the 4 variables in order (name, plan, expiry, fee) — the Remind button and the auto-reminder cron send against exactly this shape.",
    fields: {
      name: RENEWAL_TEMPLATE_NAME,
      category: "Utility",
      header_format: "none",
      body_text:
        "Hi {{1}}, your {{2}} membership expires on {{3}}. Renew now to keep your training on track — the renewal fee is {{4}}. Reply here and we'll help you renew.",
      body_samples: ["Rahul", "Quarterly", "20 Jul 2026", "₹3,999"],
    },
  },
  {
    id: "payment_receipt",
    title: "Payment receipt",
    blurb: "Confirm a payment right after you record it — reassurance the money landed.",
    category: "Utility",
    note: "Transactional confirmation of a payment the member just made — the cleanest kind of Utility template for Meta review.",
    fields: {
      name: "gym_payment_receipt",
      category: "Utility",
      header_format: "none",
      body_text:
        "Hi {{1}}, we've received your payment of {{2}} towards your {{3}} membership. Your membership is now active until {{4}}. Thank you!",
      body_samples: ["Rahul", "₹3,999", "Quarterly", "20 Oct 2026"],
    },
  },
  {
    id: "payment_due",
    title: "Payment due reminder",
    blurb: "Chase an outstanding balance without it feeling like a dunning notice.",
    category: "Utility",
    fields: {
      name: "gym_payment_due",
      category: "Utility",
      header_format: "none",
      body_text:
        "Hi {{1}}, a payment of {{2}} for your {{3}} membership is still pending. Please clear it to keep your access active. Reply here for a payment link or any help.",
      body_samples: ["Rahul", "₹3,999", "Quarterly"],
    },
  },
  {
    id: "welcome_new_member",
    title: "Welcome new member",
    blurb: "Greet a member the moment they join and open the WhatsApp thread.",
    category: "Utility",
    fields: {
      name: "gym_welcome_member",
      category: "Utility",
      header_format: "none",
      body_text:
        "Welcome to {{1}}, {{2}}! Your {{3}} membership is now active. Reply here anytime for timings, bookings, or help with your plan — glad to have you on board.",
      body_samples: ["FitZone Gym", "Rahul", "Quarterly"],
    },
  },
  {
    id: "class_booking_confirmation",
    title: "Class booking confirmation",
    blurb: "Confirm a booked class or PT slot and cut no-shows.",
    category: "Utility",
    fields: {
      name: "gym_class_booking",
      category: "Utility",
      header_format: "none",
      body_text:
        "Hi {{1}}, your booking for {{2}} on {{3}} at {{4}} is confirmed. Please arrive 10 minutes early. Reply here to reschedule or cancel.",
      body_samples: ["Rahul", "Yoga", "20 Jul 2026", "6:30 AM"],
    },
  },
  {
    id: "win_back_expired",
    title: "Win back a lapsed member",
    blurb: "Re-engage someone whose membership already ended.",
    category: "Marketing",
    note: "Promotional re-engagement — Meta reviews this as Marketing and it needs the member's marketing opt-in.",
    fields: {
      name: "gym_win_back",
      category: "Marketing",
      header_format: "none",
      body_text:
        "Hi {{1}}, we've missed you at {{2}}! Your membership ended on {{3}}. Come back this month and we'll help you pick up right where you left off.",
      body_samples: ["Rahul", "FitZone Gym", "20 Jun 2026"],
      buttons: [{ type: "QUICK_REPLY", text: "Reactivate my plan" }],
    },
  },
  {
    id: "festival_offer",
    title: "Festival / limited-time offer",
    blurb: "Promote a seasonal discount to drive renewals and new sign-ups.",
    category: "Marketing",
    note: "Promotional — Meta reviews this as Marketing and it needs the member's marketing opt-in.",
    fields: {
      name: "gym_festival_offer",
      category: "Marketing",
      header_format: "none",
      body_text:
        "Hi {{1}}, celebrate {{2}} with {{3}}! For a limited time, enjoy {{4}} off on annual memberships. Reply to grab this offer before it ends.",
      body_samples: ["Rahul", "Diwali", "FitZone Gym", "20%"],
      buttons: [{ type: "QUICK_REPLY", text: "I'm interested" }],
    },
  },
];
