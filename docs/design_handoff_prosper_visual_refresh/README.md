# Handoff: Prosper — visual refresh ("graphite instrument", second edition)

## Overview

Prosper is an offline-first personal finance PWA with a Czech UI (SvelteKit 2 + Svelte 5,
TypeScript strict, plain scoped CSS in `.svelte` files, one runtime dependency — Dexie,
hard 150 kB brotli budget on the entry route).

This package is a **visual-layer refresh of the whole app**. Flow, routing, component
structure, state and logic do not change. Every deliverable in here is either a token
value or a CSS rule inside an existing `<style>` block.

The target is a calm, modern, dense finance instrument: true-black ground for one-handed
use in bed with the lights off, surfaces raised by luminance rather than by shadow, a
single blue chrome accent, and data colours that stay distinguishable at a glance.

## About the design files

`previews/` holds **design references written as HTML** — they show intended look and
measurement, not production code. Nothing in `previews/` ships. Open each file directly
in a browser; they are self-contained apart from the sibling `support.js` and a Google
Fonts link for IBM Plex Mono.

The implementation is **not** a recreation job. The app already exists, and this refresh
is expressed as patches against its real files:

```
tokens.css            → replaces apps/web/src/lib/styles/tokens.css wholesale (step 1)
patches/step-2.md     → AppBar, TabBar, Keypad, Sheet
patches/step-3.md     → / (keypad home) + app.css button/field rules
patches/step-3b-height.md → the / height ladder (375×667, 393×759, keyboard-up 393×460)
patches/step-4.md     → /tape, /mesic, /cil, /jmeni, /settings + remaining lib/ui files
```

Apply them in that order. Each patch quotes the rule to change and carries the old value
in a comment, so a diff is verifiable by reading it.

## Fidelity

**High fidelity.** Colours, type sizes, weights, letter-spacing, radii, spacing and
touch targets in the previews are final and are all token values. Two things are
deliberately not specified pixel-exactly: the exact scroll position of each screen (the
previews show one frame of a scrolling page) and copy, which is the app's existing Czech
strings, unchanged.

## Hard constraints (do not violate these)

1. **All colour lives in `tokens.css`.** No literal hex in any component, ever.
2. **Existing token names are frozen.** `--ground`, `--surface`, `--surface-2/3`, `--ink`,
   `--ink-2/3`, `--hairline`, `--signal`, `--out`, `--in`, `--flag`, `--danger`,
   `--split-*`, `--elev-1/2/3`, `--radius-*`, `--space-*`, `--text-*`, `--dur-*`,
   `--ease-*`. Values were remapped; renaming any of them breaks ~11 000 lines of CSS.
3. **UI text is Czech. Code, identifiers and comments are English.** No exceptions in
   either direction.
4. **No new npm dependency, no new font file, without asking the owner.** The label stack
   is `system-ui, -apple-system, BlinkMacSystemFont, …` (zero bytes, resolves to real
   SF Pro on Apple hardware). Money stays IBM Plex Mono, already in the app.
5. **150 kB brotli on the entry route.** The refresh is net negative: after step 3 nothing
   references Instrument Sans, so `static/fonts/instrument-sans-*.woff2` and its two
   `@font-face` blocks in `app.css` can be deleted (≈ −97 kB). Run
   `scripts/check-bundle.mjs` last.
6. **Mobile first, not mobile only.** Design target is a 390 px viewport. Above ~600 px
   the app centres in a ~480 px column on the page ground with the same components at the
   same sizes and the tab bar where it is. There are no breakpoint-specific layouts, no
   sidebars, no multi-column dashboards. Do not invent any.
7. **Touch targets 44 px minimum.** Several elements are *drawn* smaller (24 px chips,
   20 px ticks) and given their 44 px back with an `::after` hit area. Keep that pattern.

## The four laws of this refresh

Everything in the patches follows from these. If a new component is needed later, derive
it from these rather than inventing a treatment.

**1. Elevation is luminance, not shadow.** Shadows are withdrawn from every resting
surface. A card is raised because it is lighter than the ground. `--elev-1` is a valid
no-op (`0 0 0 0 rgb(0 0 0 / 0%)`) so existing comma lists keep parsing. Real shadow
survives only where a layer genuinely floats over content: `Sheet` (`--elev-sheet`),
`Toaster` (`--elev-3`), and the ≥35rem centred sheet.

**2. Recession is a pocket.** No `inset` shadows anywhere. Inside a card, recessed =
`--ground-2`, raised = `--raised`. This is the step-4 law and it holds in both themes:

| | dark | light |
| --- | --- | --- |
| recessed (well) | `#0c0c0e` | `#e8e8ec` |
| raised | `#2a2a2c` | `#ffffff` |

Applies to: the gap day in the ledger, the goal's `why` slab, the theme segment track,
every meter track, every field input.

**3. One press, one number.** Every button presses with `transform: scale(0.95)` over
`--dur-press` (90 ms). Nothing else moves — no translate, no shadow change, no nested
glyph scale. The one exception is a full-bleed list row (`.row`, `.blank`), which presses
by background luminance: scaling a 100 %-wide row by 5 % shows the ground through its
own corners.

**4. Pill is reserved for the primary action.** `--radius-full` on a button means "this is
the action". Utility 8 px (`--radius-sm`), capsule 11 px (`--radius`), fields and
segments 8 px, cards 18 px (`--radius-lg`), sheets and the keypad shell 24 px
(`--radius-xl`). Two buttons of equal size are told apart by shape, not by a second
colour.

## Colour roles

**Chrome accent is single and is `--signal` (blue).** Links, primary buttons, focus ring,
current selection, the tab-bar wash pill, the record disc. It is never decoration and
never a data colour.

**Data colour is exempt from the single-accent rule** and must stay distinguishable at a
glance:

- `--in` (mint) — money in
- `--flag` (amber) — look at this
- `--danger` (coral) — destroy or refuse
- `--split-give / -save / -debt / -live` — the four classes of the 10/10/10/70 ring,
  plus `--split-left` as the ghost "what's left" segment and as every meter track

**Money going out has no hue.** `--out` is the ink. A ledger is mostly outflow, and forty
red numbers is noise. The only mint number on a ledger screen is an inflow.

All four data hues sit near the same oklch lightness and chroma per theme, so no class
shouts over another. Do not re-tune one in isolation.

**Dark is the primary theme; light is its daylight counterpart.** Both are fully
specified in `tokens.css` (`prefers-color-scheme` block plus explicit
`[data-theme='dark']` / `[data-theme='light']`).

## Design tokens

Read `tokens.css` — it is the source of truth and it is commented. Summary:

**Dark (primary):** ground `#000000`, ground-2 `#0c0c0e`, surface `#1d1d1f`, surface-2
`#252527`, surface-3 `#2a2a2c`, raised = surface-3. Hairlines `rgb(255 255 255 / 9%)` and
`/ 16%`. Ink `#f5f5f7`, ink-2 66 %, ink-3 52 %. Signal `#409cff` on `#06213d`. In
`#4ccfa1`, flag `#dfb567`, danger `#ef6f5e`. Splits `#a294ec / #4ccfa1 / #d3a15e /
#8b9299`, left `#232326`.

**Light:** ground `#f5f5f7`, ground-2 `#e8e8ec`, surface `#ffffff`, surface-2 `#fafafc`,
surface-3 `#f2f2f5`, raised = surface. Hairlines `rgb(29 29 31 / 8%)` and `/ 15%`. Ink
`#1d1d1f`, ink-2 72 %, ink-3 60 %. Signal `#0066cc` on white. In `#007850`, flag
`#8a6400`, danger `#c93f32`. Splits `#6353c4 / #007850 / #8f6508 / #6e7478`, left
`#e2e2e7`.

**Type.** Ladder is 300 / 400 / 600 / 700 — **weight 500 does not exist in this app**.
Sizes: 2xs 11 (micro-labels only), xs 12, sm 13, md 14, base 16 (the floor for anything
read on a phone), lg 18, xl 22, 2xl 28, 3xl 34, display `clamp(3rem, 14vw, 4.25rem)`.
Tracking: display −0.025em, tight −0.02em, label +0.08em (the only place uppercase is
allowed). Money is always `--font-mono` with `font-variant-numeric: tabular-nums`.

**Space.** 4 px base: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 56. Phone screens use 12–16 px
gutters and 16 px card padding. Section padding of 24 px+ belongs to a marketing page,
not to this app.

**Motion.** press 90 ms, fast 150, base 220, slow 360. Easings `--ease-out`
`cubic-bezier(0.16, 1, 0.3, 1)`, `--ease-in-out`, `--ease-settle`.

**Targets.** touch 44, touch-lg 54, control 24, tabbar 58.

## Screens

Route by route, with the preview that specifies it. Every screen is AppBar → scrolling
content column (12 px gutters, 12 px gap between cards) → TabBar, except `/` which is a
fixed non-scrolling layout.

### `/` — keypad · `previews/Entry Screen v2.dc.html`, `patches/step-3.md` + `step-3b-height.md`

Record a transaction in under 5 seconds. The amount is the hero. Fixed layout, no scroll:
month slab → due strip → the amount (flex: 1, floats in `--ambient-out` / `--ambient-in`)
→ context panel (category chips, date + payee field, two props) → live check strip →
keypad shell. `step-3b-height.md` carries the exact height budget at 375×667, 393×759 and
393×460 (software keyboard up) and the per-breakpoint diff; the key clamp
`clamp(var(--touch), 6.4dvh, 56px)` is settled and must not be re-tuned.

### `/tape` — Výpis · preview section 4a

Balance slab (display size, right-aligned, plus a full-width "Srovnat s bankou" row that
carries how long since last reconciliation) then month cards. Dense rows: category +
payee left, amount + running balance right, running balance in `--ink-3`. A day with no
records is a **hole**: `--ground-2`, and its press goes *up* to `--surface-2`.

### `/mesic` — Měsíc · preview section 4b

Month switcher in the AppBar (22/600 between two 44 px chevrons). MonthTotals slab → the
one-off/recurring aside → goal card → Zápisy coverage ring → Kontrola findings → the
10/10/10/70 split ring with legend and verdict → Kam to šlo buckets with meters and
trend lines. Ring track and meter track are the pocket; fills carry the role.

### `/cil` — Cíl · preview section 4c

Goal card (name + "na očích" capsule, the `why` set into a `--ground-2` slab in italic at
16 px, total progress, deadline) → this month's card (progress, `Odložit` as the only pill
on the screen, `Upravit cíl měsíce` as a 14 px secondary) → month history rows with a
completed tick.

### `/jmeni` — Jmění · preview section 4d

Total slab (display size, centred, then Na účtu / V investicích) then one card per
holding: a single `--split-*` dot, name, amount, valuation date. A stale valuation raises
a `--flag-wash` strip inside its own holding card — same grammar as the due strip on `/`.
Not in the tab bar; reached from `/mesic` findings and `/settings`.

### `/settings` — Nastavení · preview section 4e

Cards: Účet (fields + primary pill) · Kategorie (44 px rows, coloured type dot, archive
action, add row) · Pravidelné platby · Jmění · Synchronizace · Vzhled (3-way segment,
track = pocket, selection = `--raised`, no shadow) · Data (export buttons + facts rows).
Preview shows Účet, Kategorie, Vzhled and Data; the other three are the same row / field
/ secondary-button grammar and get no screen-specific diff.

## Interactions & behaviour

Unchanged from the current app — this is a visual refresh, and no handler, transition
target or navigation was touched. What the refresh does change:

- **Press:** `scale(0.95)` / 90 ms on buttons; background luminance on full-bleed rows.
- **Hover** (`@media (hover: hover)` only): `filter: brightness(1.06)` on the primary
  fill, one step of ink or surface elsewhere. Never a lift, never a shadow.
- **Focus:** `border-color: var(--signal)` plus `box-shadow: 0 0 0 3px var(--signal-wash)`.
  This is the one non-floating shadow that stays, because it is a ring, not depth.
- **Meters** animate `width` (not `scaleX`) over `--dur-slow`; they are pill-shaped and
  scaling one horizontally turns the end cap into an ellipse.

## State management

No change. Dexie `liveQuery` subscriptions, Svelte 5 runes, the hand-rolled `$effect`
subscription on `/mesic` (documented in place — it exists because the `$`-store form left
the AppBar switcher rendering against the empty first tick). Do not refactor any of it as
part of this work.

## Assets

None added. No images, no new icons, no new fonts. Icons are the existing `Icon.svelte`
stroke set; the previews redraw a handful of them inline as SVG purely to be
self-contained — use `Icon.svelte` in the app.

## Files in this bundle

```
README.md                      this file
tokens.css                     step 1 — drop-in replacement, not a diff
patches/step-2.md              AppBar, TabBar, Keypad, Sheet
patches/step-3.md              / and app.css
patches/step-3b-height.md      / height ladder, three viewports
patches/step-4.md              the remaining five screens + lib/ui leftovers
previews/support.js            required by the .dc.html previews
previews/Tokens Preview.dc.html    both themes as swatches
previews/Base Components.dc.html   AppBar, TabBar, Sheet, Keypad
previews/Entry Screen.dc.html      / rev A
previews/Entry Screen v2.dc.html   / rev B — real height budgets
previews/Screens v4.dc.html        Výpis, Měsíc, Cíl, Jmění, Nastavení, dark + light
```

## Order of work

1. Replace `tokens.css`. Verify both themes at `previews/Tokens Preview.dc.html`.
2. Apply `step-2.md`, then `step-3.md`, then `step-3b-height.md`, then `step-4.md`.
3. Delete the Instrument Sans woff2 files and their two `@font-face` blocks in `app.css`.
4. Run `scripts/check-bundle.mjs` and confirm the entry route is under 150 kB brotli.
5. Grep the codebase for two things that must return nothing: a literal hex outside
   `tokens.css`, and `font-weight: 500`.
