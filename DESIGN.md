---
name: UsefulDesk
description: A quiet, trustworthy control desk for running an Indian gym.
colors:
  dark-canvas: 'oklch(0.13 0.01 260)'
  dark-ink: 'oklch(0.985 0 0)'
  dark-card: 'oklch(0.18 0.01 260)'
  dark-tile: 'oklch(0.205 0.01 260)'
  dark-muted: 'oklch(0.22 0.01 260)'
  dark-muted-text: 'oklch(0.65 0.01 260)'
  dark-border: 'oklch(0.28 0.01 260)'
  light-canvas: 'oklch(1 0 0)'
  light-ink: 'oklch(0.21 0.01 260)'
  light-tile: 'oklch(0.985 0.002 260)'
  light-muted: 'oklch(0.967 0.003 260)'
  light-muted-text: 'oklch(0.52 0.015 260)'
  light-border: 'oklch(0.922 0.004 260)'
  violet: 'oklch(0.54 0.24 293)'
  violet-hover: 'oklch(0.49 0.24 293)'
  emerald: 'oklch(0.62 0.16 162)'
  cobalt: 'oklch(0.55 0.19 254)'
  amber: 'oklch(0.745 0.16 65)'
  rose: 'oklch(0.58 0.21 16)'
typography:
  display:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.01em'
  headline:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.5556
  title:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.4286
  label:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.3333
  meta:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 400
    lineHeight: 1.4545
  mono:
    fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.3333
rounded:
  sm: '6px'
  md: '8px'
  lg: '10px'
  xl: '14px'
  2xl: '18px'
  3xl: '22px'
  4xl: '26px'
  full: '9999px'
spacing:
  '1': '4px'
  '1.5': '6px'
  '2': '8px'
  '2.5': '10px'
  '3': '12px'
  '4': '16px'
  '5': '20px'
  '6': '24px'
  '8': '32px'
components:
  button-primary:
    backgroundColor: '{colors.violet}'
    textColor: '{colors.dark-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
  button-primary-hover:
    backgroundColor: '{colors.violet-hover}'
    textColor: '{colors.dark-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
  button-outline:
    backgroundColor: 'transparent'
    textColor: '{colors.dark-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
  button-pill-active:
    backgroundColor: 'oklch(0.54 0.24 293 / 0.12)'
    textColor: '{colors.violet}'
    typography: '{typography.body}'
    rounded: '{rounded.full}'
    padding: '0 10px'
    height: '32px'
  input:
    backgroundColor: 'transparent'
    textColor: '{colors.dark-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '4px 10px'
    height: '32px'
  chip-selected:
    backgroundColor: 'oklch(0.54 0.24 293 / 0.12)'
    textColor: '{colors.violet}'
    typography: '{typography.body}'
    rounded: '{rounded.full}'
    padding: '0 10px'
    height: '32px'
  card:
    backgroundColor: '{colors.dark-card}'
    textColor: '{colors.dark-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.xl}'
    padding: '16px'
  badge-status:
    backgroundColor: 'oklch(69.6% 0.17 162.48 / 0.1)'
    textColor: 'oklch(69.6% 0.17 162.48)'
    typography: '{typography.label}'
    rounded: '{rounded.4xl}'
    padding: '2px 8px'
    height: '20px'
---

# Design System: UsefulDesk

## Overview

**Creative North Star: "The Owner's Control Desk"**

UsefulDesk should feel like the steady operational surface a gym owner opens to regain control: quiet enough to scan under pressure, compact enough to keep the day's work visible, and explicit enough that status and next action are never ambiguous. The system is utilitarian and trustworthy rather than austere; it earns confidence through consistent geometry, contrast-safe semantic color, and predictable interaction feedback.

The interface is restrained at rest. Neutral surfaces carry the structure, the selected account accent marks action and focus, and status hues communicate domain state without competing with the main workflow. Hover and pressed states remain clearly perceptible, but they strengthen an existing edge, tint, or position instead of adding ornament.

Avoid decorative SaaS gradients, oversized marketing typography, ornamental depth, and dashboard chrome that competes with action lists.

**Key Characteristics:**

- Dark-first neutral workspace with a complete light mode.
- Compact controls and deliberate 4px-based rhythm.
- One user-selected accent at a time; domain statuses retain fixed semantic hues.
- Structural layering through tonal surfaces, borders, and rings.
- Refined components with clear hover, focus, selected, pressed, invalid, and disabled states.

## Colors

The palette is a blue-violet-biased neutral workspace whose mode and account accent are independent axes.

### Primary

- **Violet** (`colors.violet`): the default account accent for primary actions, selection, focus, the leading chart series, and active navigation.
- **Emerald** (`colors.emerald`), **Cobalt** (`colors.cobalt`), **Amber** (`colors.amber`), and **Rose** (`colors.rose`): complete alternate account accents. Only one accent family is active at a time, and each supplies contrast-appropriate foreground, hover, soft-tint, chart, and focus roles in code.

### Neutral

- **Dark Canvas**, **Dark Card**, and **Dark Tile** (`colors.dark-canvas`, `colors.dark-card`, `colors.dark-tile`): the default mode's page, panel, and nested tile progression.
- **Dark Ink** and **Dark Muted Text** (`colors.dark-ink`, `colors.dark-muted-text`): primary and secondary text in dark mode.
- **Dark Muted** and **Dark Border** (`colors.dark-muted`, `colors.dark-border`): neutral fills and structural edges in dark mode.
- **Light Canvas**, **Light Tile**, and **Light Muted** (`colors.light-canvas`, `colors.light-tile`, `colors.light-muted`): the light mode's white workspace and subtle nested surfaces.
- **Light Ink**, **Light Muted Text**, and **Light Border** (`colors.light-ink`, `colors.light-muted-text`, `colors.light-border`): text and edge roles in light mode.

### Named Rules

**The Two-Axis Rule.** Mode controls neutral surfaces; theme controls the primary accent. Never make an account accent redefine the neutral workspace.

**The Accent-as-Signal Rule.** Use the active accent for actions, selection, links, focus, and the first chart series. Fixed domain statuses use their semantic success, danger, warning, information, violet, orange, pink, or neutral hue instead.

**The Contrast-Role Rule.** Accent-colored text uses the contrast-adjusted primary-text role, not the primary fill value. Form controls use the stronger input-border role; decorative divisions use the quieter border role.

## Typography

**Display Font:** Inter (with `ui-sans-serif`, `system-ui`, and `sans-serif` fallbacks)

**Body Font:** Inter (with `ui-sans-serif`, `system-ui`, and `sans-serif` fallbacks)

**Label/Mono Font:** Geist Mono (with `ui-monospace`, SFMono-Regular, Menlo, and `monospace` fallbacks)

**Character:** One sans-serif family keeps the product plainspoken and internally consistent. Hierarchy comes from weight, size, and spacing rather than a decorative display face; Geist Mono is reserved for code, token names, identifiers, and technical values.

### Hierarchy

- **Display** (700, 28px, 1.0): dashboard metrics and other short, high-value numerals; never long headings.
- **Headline** (600, 18px, 1.56): app-bar titles and the highest local page heading where the shell does not already provide one.
- **Title** (500, 16px, 1.5): card titles, dialog titles, and compact section hierarchy.
- **Body** (400, 14px, 1.43): default interface copy, tables, controls, and descriptions. Text inputs remain 16px below the medium breakpoint to prevent mobile browser zoom, then settle to 14px.
- **Label** (500, 12px, 1.33): metadata, compact counts, badges, and secondary labels. Uppercase is exceptional and reserved for genuinely categorical micro-labels.
- **Meta** (400, 11px, 1.45): the smallest documented step, and the only one below Label. It exists for chat metadata — the timestamp, delivery ticks, and provenance markers riding inside a message bubble — where a 12px run would take space the message itself needs. Do not reach for it to shrink an ordinary label; a label that will not fit at 12px is a layout problem, not a type problem.

### Named Rules

**The Shell-Owns-the-Title Rule.** Authenticated routes use the shared app-bar title; page content must not repeat it as a second large heading.

**The Stable-Numerals Rule.** Every rendered money value and animated metric uses tabular lining numerals so scanning columns and changing values never jitter.

## Layout

UsefulDesk uses a fixed-height application shell. On large screens, a 240px sidebar can collapse to a 64px rail; on smaller screens it becomes a 256px drawer over a dimmed, blurred backdrop. The 56px app bar owns the page title, primary actions, and optional tab row. Main content uses 16px horizontal padding on phones and 24px from the small breakpoint upward.

The base spacing unit is 4px. Compact control internals lean on 4–10px steps; component groups typically use 8–16px gaps; page sections use 20–32px separation according to hierarchy. Cards and action lists should preserve high information density without crowding: related controls stay close, while distinct work queues receive visible separation.

Responsive behavior is functional. Grids collapse from four columns toward two or one, tables scroll horizontally rather than compressing their content into unreadable cells, chip groups remain a single horizontally browsable row, and dialogs keep a 16px viewport margin. Primary actions stay reachable in the app bar or an established mobile affordance.

**The Action-List Rule.** Layout prioritizes the work that needs action today; summary metrics support those lists instead of pushing them below ornamental dashboard content.

**The Shared-Chrome Rule.** Titles, actions, tabs, filters, and table controls use their shared shell slots and toolbar families. Do not create page-local substitutes for existing chrome.

## Elevation & Depth

The elevation philosophy is structural layering. Resting cards and tiles are flat: tonal steps, a one-pixel border, or a low-contrast ring establish containment. Shadows are reserved for elements that truly move above the page plane—menus, popovers, dialogs, preview cards, and sheets. Focus is expressed with a three-pixel accent ring at half strength plus a matching border, not with a generic drop shadow.

### Shadow Vocabulary

- **Control Lift** (`0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`): checked controls, compact active tabs, and small floating browse buttons.
- **Floating Panel** (`0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): menus, selects, popovers, and preview cards.
- **Modal Sheet** (`0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): sheets and the strongest temporary layer.

### Named Rules

**The Structural-Layering Rule.** Surfaces are flat at rest. Use borders and tonal separation for hierarchy; add a shadow only when an element is spatially above another surface.

**The Edge-Strengthening Rule.** A clickable card keeps its fill stable on hover and strengthens its border. Changing both fill and edge makes a quiet surface feel noisy.

## Shapes

The base corner radius is 10px. Standard controls use gently curved 10px corners, compact controls use 6–8px corners, and cards, dialogs, and substantial containers use 14px corners. Larger scale steps exist for composed surfaces but remain derived from the same base. Choice chips and pill triggers are fully rounded; status badges use the 26px radius step, which reads as a pill at their 20px height. Checkboxes retain a compact 4px corner so their square affordance stays legible.

Borders are thin and semantic: quiet decorative edges, stronger form-control outlines, and accent focus or selected edges. Circular geometry is reserved for avatars, icon discs, counters, and compact indicators.

**The One-Radius-Family Rule.** Reuse the established radius scale. Do not introduce arbitrary corner values at a page call site.

## Components

Components are refined and restrained at rest, with ideal hover and pressed feedback: hover clarifies affordance, focus is unmistakable, and pressing produces a brief physical response without theatrical motion.

### Buttons

- **Shape:** gently curved rectangle (10px); pill triggers use a fully rounded silhouette.
- **Primary:** active account accent with contrast-safe foreground, 32px default height, 10px horizontal padding, and medium 14px type.
- **Hover / Focus / Pressed:** primary hover moves to the theme's calibrated hover value; focus adds the standard three-pixel ring; ordinary buttons translate down one pixel while pressed.
- **Outline / Secondary / Ghost:** outline buttons use the neutral canvas and structural edge; secondary buttons use the neutral secondary fill; ghost buttons reveal a muted hover layer without adding a resting border.
- **Destructive:** destructive actions use a subtle red tint and readable red text, not a solid alarming block by default.

### Chips

- **Style:** one fully rounded, outlined choice family at 32px default height. Chips never imitate rectangular outline buttons.
- **State:** unselected chips use muted text and a neutral edge; selected chips use the account accent's soft tint, accent text role, and accent edge. A chip group is one horizontally browsable row and declares single or multiple selection.

### Cards / Containers

- **Corner Style:** softly contained (14px).
- **Background:** card surface at rest; the secondary card surface is reserved for nested tiles or specific hover/frozen-cell needs.
- **Shadow Strategy:** flat by default, following the Structural-Layering Rule.
- **Border:** one-pixel structural border or low-contrast one-pixel ring.
- **Internal Padding:** 16px by default, 12px for the compact size, and 20px for metric cards that need stronger numeric hierarchy.

### Inputs / Fields

- **Style:** 32px high, transparent in light mode, softly filled in dark mode, with a 10px radius and a dedicated contrast-safe form outline.
- **Focus:** border shifts to the active ring color and gains the standard three-pixel half-strength focus ring.
- **Error / Disabled:** invalid fields use the destructive edge and ring; disabled fields use a subdued fill and opacity while retaining legible content.

### Navigation

- **Style:** a neutral sidebar distinct from the page canvas, 14px medium-weight rows, 16px line icons, and 10px corners.
- **State:** hover adds a quiet foreground tint; active navigation uses the account accent's soft fill and contrast-adjusted accent text. Collapsing the sidebar preserves icons and status indicators while labels fade and contract.
- **Mobile:** navigation becomes a left drawer with a blurred backdrop and an explicit 44px menu target in the app bar.

### Badges and Status

- **Style:** 20px-high, fill-only tinted pills with 12px medium text and no visible border.
- **State:** fixed domain statuses map through canonical semantic variants. Administrator-created tags remain neutral slate; database-driven custom colors use the contrast-derived tint fallback.
- **Separation:** badges communicate status or category. Interactive choices use Chips, and compact counters use the dedicated count size.

### Tables and Toolbars

- **Tables:** 14px type, 40px headers, compact 8px cells, horizontal overflow, muted hover rows, and sticky-column treatments only where the shared table implements them.
- **Toolbars:** bounded 32px segmented controls with shared borders and dividers. Pressed segments use the account accent's soft tint and accent text role.

### Metric and Action Cards

- **Metric cards:** quiet bordered cards with a muted icon tile, 28px bold tabular value, and a compact semantic delta.
- **Action cards:** strengthen their border on hover without changing fill. Their icon tile remains neutral so the action label carries the hierarchy.

## Do's and Don'ts

### Do:

- **Do** resolve color through semantic roles so every accent works in both light and dark modes.
- **Do** reuse the canonical primitives and their variants before composing a new pattern.
- **Do** keep controls compact, labels literal, and today's actions visible near the top of an operational surface.
- **Do** use the shared three-pixel focus treatment and honor reduced-motion preferences.
- **Do** keep money and animated metrics in tabular numerals.
- **Do** reserve shadows for floating layers and use borders or tonal steps for resting hierarchy.

### Don't:

- **Don't** use gradients, glass effects, ornamental shadows, or oversized marketing type in authenticated product surfaces.
- **Don't** hard-code a theme hue or a light/dark value at a call site; use the semantic token layer.
- **Don't** use the primary fill color directly for text, or the decorative border where a form-control outline is required.
- **Don't** override Badge, Chip, Toolbar, Button, Card, or field geometry to create a page-specific look.
- **Don't** turn a clickable choice into a badge, or a menu trigger into a chip.
- **Don't** repeat the shell's page title inside content or build a second local action bar.
- **Don't** animate table rows or ancestors of sticky table columns with transforms.
