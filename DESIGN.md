---
name: TeamTask
description: Task and team management platform for a digital agency
colors:
  primary: "#8E1B3B"
  primary-dark: "#6B1020"
  primary-hover: "#B4234C"
  bg: "#F1F1F4"
  surface: "#FFFFFF"
  surface-2: "#F4F4F7"
  surface-3: "#FAFAFB"
  text: "#16161D"
  text-secondary: "#454552"
  text-muted: "#6E6E7C"
  text-light: "#9B9BA8"
  success: "#16A34A"
  warning: "#D9822B"
  danger: "#E5484D"
  accent: "#3B82F6"
  dark-bg: "#0B0B0F"
  dark-surface: "#15151B"
  dark-surface-2: "#1E1E27"
  dark-primary-accent: "#E24B67"
typography:
  display:
    fontFamily: "Gotham, system-ui, -apple-system, sans-serif"
    fontSize: "42px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Gotham, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Gotham, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Gotham, system-ui, -apple-system, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
  pill: "20px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: TeamTask

## 1. Overview

**Creative North Star: "The Command Ledger"**

TeamTask is a calm, single-surface workspace for an agency's daily task and project accounting. Unlike the earlier dark-sidebar-vs-light-canvas version of this system, the current build is unified neutral: sidebar, topbar, and content all sit on the same light (or, in dark theme, the same near-black) base — there is no structural light/dark split between navigation and content anymore. Burgundy (#8E1B3B) is the one committed brand color, and it now carries two roles rather than one: the reserved action/active-state color everywhere else in the system, *and* a single named hero exception — the dashboard's "Выполнено" (Done) stat tile, which is intentionally rendered as a full burgundy gradient with soft blur orbs, distinguishing the primary completion metric from its three plain-white sibling tiles.

This system explicitly rejects toy interfaces, emoji-as-decoration, decorative gradients used indiscriminately, glassmorphism-for-its-own-sake, and animation that exists for spectacle rather than feedback — the one hero-card gradient is the sanctioned exception to "no decorative gradients," not a loophole to reuse elsewhere.

**Key Characteristics:**
- Unified neutral surface (no dark/light structural split between sidebar and canvas)
- One committed brand color (burgundy) for actions, active state, and exactly one named hero metric
- A real, fully-tokenized dark theme (`[data-theme="dark"]`) alongside light — not an afterthought
- Ambient, colorless shadows (`rgba(17,17,26,...)`) for elevation — never tinted, never theatrical
- Restrained, functional motion; the one animated exception (the Done-card blur orbs) is static decoration, not motion

## 2. Colors

A restrained neutral palette with one committed brand color and a fixed semantic set, defined for both light and dark theme.

### Primary
- **Ledger Burgundy** (#8E1B3B): primary actions, active nav/tab/filter state, focus rings, links-as-actions, and the dashboard's one sanctioned hero-metric card.
- **Ledger Burgundy Hover** (#B4234C): hover state for primary actions and the Done-card gradient's lighter stop.
- **Ledger Burgundy Deep** (#6B1020): darkest ramp step, used sparingly (gradients, pressed states).
- **Burgundy Wash** (`rgba(142,27,59,.10)` light / `rgba(142,27,59,.15)` dark): tint background for active/hover states on outline buttons, filters, active nav — never a body background.

### Neutral (Light theme)
- **Canvas** (#F1F1F4): app base background.
- **Surface** (#FFFFFF): cards, sidebar, topbar — the primary content plane.
- **Surface Dim** (#F4F4F7): secondary panel fill (feedback box, icon backgrounds).
- **Ink** (#16161D): primary text.
- **Ink Secondary** (#454552): secondary text, form labels at rest.
- **Ink Muted** (#6E6E7C): metadata, captions, sidebar nav text at rest.
- **Ink Faint** (#9B9BA8): disabled/dimmed text.
- **Hairline** (`rgba(17,17,26,.07)`): default borders, at low, colorless opacity.

### Neutral (Dark theme, `[data-theme="dark"]`)
- **Dark Canvas** (#0B0B0F), **Dark Surface** (#15151B), **Dark Surface 2** (#1E1E27).
- **Dark Ink** (#F3F3F6) / **Dark Ink Muted** (#8B8B98).
- **Dark Primary Accent** (#E24B67): the primary/danger accent brightens in dark theme for visibility against the near-black base — this is a deliberate dark-mode adjustment, not palette drift.

### Semantic
- **Confirmed Green** (#16A34A): done status, positive metrics.
- **Pending Amber** (#D9822B): in-progress status, soon-due deadlines.
- **Overdue Red** (#E5484D light / #E24B67 dark): overdue deadlines, destructive actions, high-priority badges.
- **Info Blue** (#3B82F6): "new" status only.

### Named Rules
**The One Hero Exception Rule.** Burgundy appears as decorative gradient fill in exactly one place system-wide: the dashboard's "Выполнено" stat card (`.dash-stat-card--done`). Every other surface follows the One Accent Rule below. Do not extend the gradient-fill treatment to any other card, tile, or component — its rarity is what makes it a hero, not a template.

**The One Accent Rule (everywhere else).** Outside the one named exception, burgundy appears only at decision points: primary buttons, active nav/tab/filter state, focus rings, links. It never appears as decorative background or emphasis-by-tint on body text elsewhere.

**The Semantic-Only Blue Rule.** Accent blue (#3B82F6) is reserved exclusively for the "new" task status.

## 3. Typography

**Display Font:** Gotham (400/700, self-hosted via woff2), falling back to system-ui, then -apple-system.
**Body Font:** same Gotham family — one typeface across every role, differentiated by weight and size.

**Character:** A single confident grotesque carried across every role; hierarchy comes from weight and size, not typeface switching.

### Hierarchy
- **Display** (800, 42–46px, line-height 1, letter-spacing -0.03em): dashboard KPI numbers (`.dsc-value`). The Done-card variant runs slightly larger (46px) as part of its hero treatment.
- **Title** (700, 15–19px, line-height 1.3): section titles, modal titles, card names.
- **Body** (400–600, 13–14px, line-height 1.4): task titles, form values, comments. Cap prose blocks at 65–75ch.
- **Label** (700, 10.5–11px, letter-spacing 0.08em, uppercase): field labels, `.dsc-label`, table headers, sidebar section labels — always uppercase, always tracked.

### Named Rules
**The Weight-Not-Style Rule.** Hierarchy is built by weight and size shifts within one family, never by switching fonts or adding italics.

## 4. Elevation

Layered and ambient, using colorless shadow tints (`rgba(17,17,26,...)` in light, `rgba(0,0,0,.6)` in dark) rather than tinted or theatrical shadows. Depth increases on hover/interaction. The Done-card is the one component with a colored (burgundy-tinted) shadow — `0 8px 24px -8px rgba(142,27,59,.5)` — matching its hero-exception status; every other elevated surface uses the neutral shadow scale.

### Shadow Vocabulary
- **shadow** (`0 1px 3px rgba(17,17,26,.06), 0 1px 2px rgba(17,17,26,.04)`): default resting elevation for cards and stat tiles.
- **shadow-md** (`0 4px 14px rgba(17,17,26,.08)`): hover/interactive elevation.
- **shadow-lg** (`0 16px 40px rgba(17,17,26,.14)`): modals, notification panel, login card.
- **Hero shadow** (`0 8px 24px -8px rgba(142,27,59,.5)`): exclusive to `.dash-stat-card--done`.

### Named Rules
**The Neutral-Shadow Rule.** Shadows are colorless (tinted toward ink, not toward brand) everywhere except the one named hero exception.

## 5. Components

Restrained and precise, with one deliberately loud exception (the Done stat card) that stands out precisely because everything around it doesn't.

### Buttons
- **Shape:** 8px radius (`--radius-sm`) standard; `.btn-blue` (the prominent CTA variant, e.g. "Новая задача") uses full-pill 20px radius with a burgundy gradient fill and a soft burgundy glow shadow — a second, smaller sanctioned use of decorative burgundy treatment, reserved for the single primary top-bar CTA.
- **Primary (`btn-primary`):** solid burgundy background, white text, 700 weight, 8px radius, transparent 1.5px border for height-matching with outline buttons.
- **Outline (`btn-outline`):** surface background, hairline border, secondary-ink text; hover shifts border/text to burgundy with a wash background.
- **Danger (`btn-danger`):** danger-light background, danger-red text, hairline red border; `btn-danger-solid` (solid red fill) exists for higher-stakes destructive actions.
- **Ghost (`btn-ghost`):** no border/background at rest; hover adds canvas background.
- **Icon button (`btn-notif`):** 38×38px, 11px radius, surface-2 fill with hairline border; hover shifts border/text to burgundy.

### Cards
- **Corner Style:** 20px radius (`--radius-lg`) is now the standard for cards and dashboard stat tiles (raised from an earlier, smaller radius) — softer, more pronounced rounding than buttons/inputs.
- **Background:** `var(--surface)` (white in light, `#15151B` in dark).
- **Shadow Strategy:** `shadow` at rest, `shadow-md`/translateY(-3px) lift on hover for clickable cards.
- **Border:** 1px colorless hairline.
- **The Done Stat Card (named exception):** `.dash-stat-card--done` — burgundy-to-burgundy-hover diagonal gradient (145deg), two blurred white/pink "orb" pseudo-decorations (`.dsc-orb--1`/`--2`) positioned absolute behind the content, white text throughout, hero shadow. This is the system's single permitted decorative-gradient-plus-blur component; do not replicate the pattern elsewhere.

### Inputs / Fields
- **Style:** 1.5px hairline border, 8px radius, surface background, 13.5–14px text.
- **Focus:** border shifts to burgundy plus a 3px burgundy-tinted glow ring.

### Navigation (Sidebar)
- **Style:** fixed-width (256px), `var(--sidebar-bg)` — white in light theme, semi-transparent dark blur (`rgba(16,16,22,.95)` + backdrop-filter) in dark theme. No structural dark/light split against the canvas in light mode; the sidebar and content plane share the same neutral surface family.
- **Default/Hover/Active:** hover adds `var(--sidebar-hover)` (a subtle surface-2 tint) and shifts text toward ink; active state adds a burgundy wash background (`var(--sidebar-active-bg)`) plus burgundy text color — no left-border stripe here. The active-indicator is wash + color-shift only.
- **Section labels:** uppercase, tracked, `var(--text-light)` — genuinely quiet, unlike the darker earlier version.

### Colored Left Border (data-driven category/urgency indicator)
A 3–4px solid `border-left`, colored dynamically from data, is an established system-wide pattern for signaling category or urgency at a glance — **not** a decorative accent and not limited to one component. Confirmed uses: task cards (`urgentBorder` — red for overdue, orange for due-today, amber for due-tomorrow, `js/app.js:2909`), content-plan chips (colored by task type, `js/app.js:2230`), workload project-picker buttons (colored by project, `js/app.js:6058`), and finance summary cards (colored by category, `js/app.js:8480`). All four share the same shape: a thin, saturated, data-bound border-left carrying a single piece of categorical meaning, paired with rounded-on-one-side corners.

**Named Rule — The Data-Bound Border Rule.** A colored `border-left` is legitimate exactly when its color is computed from data (urgency level, category, project, task type) and communicates that one fact at a glance. It is illegitimate when it's a static, hardcoded decorative accent unrelated to any data value. Before adding a new one, confirm it's driven by a real data field — if it's just "this card needs to pop," use a different affordance (icon, badge, background tint) instead.

### Badges / Status Pills
- **Style:** full-pill radius (20px), 11–11.5px semibold text, tinted background matching semantic color.
- **Status set:** new (blue), in_progress (amber), done (green), pending_review (violet `#f3f0ff`/`#6d28d9` — a new status not in the original documented set, confirm before extending further).

## 6. Do's and Don'ts

### Do:
- **Do** keep burgundy (#8E1B3B) as the accent for actions and active states everywhere except the two named exceptions (Done stat card, primary CTA button).
- **Do** treat the Done stat card's gradient-plus-blur-orb treatment as a one-off hero component — never copy it onto another card or tile.
- **Do** use colorless ambient shadows (`rgba(17,17,26,...)`) for elevation everywhere except the Done card's burgundy-tinted shadow.
- **Do** build hierarchy through Gotham's weight range, not through switching typefaces.
- **Do** keep status color semantics fixed: green = done/positive, amber = pending/soon, red = overdue/destructive, blue = new-status only, violet = pending_review.
- **Do** respect `prefers-reduced-motion` on every transition and animation (WCAG AA per PRODUCT.md).
- **Do** maintain full light/dark theme parity — every new token needs both a light and `[data-theme="dark"]` value.

### Don't:
- **Don't** introduce toy-app visual language: no emoji-as-decoration, no playful illustration, no mascot elements.
- **Don't** add a colored `border-left` that is hardcoded/static rather than data-bound (see The Data-Bound Border Rule) — legitimate uses (task urgency, category, project color) are fine; decorative ones aren't.
- **Don't** extend decorative gradient fills beyond the two named exceptions (Done stat card, `.btn-blue` primary CTA).
- **Don't** add bounce, elastic, or overshoot easing to any transition.
- **Don't** introduce a second accent color competing with burgundy; map new semantic needs to the existing green/amber/red/blue/violet set first.
- **Don't** let body or placeholder text drop below 4.5:1 contrast in either theme — verify dark-theme contrast separately, it does not inherit light-theme guarantees automatically.
