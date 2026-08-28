# Step 4 — the remaining screens, visual layer only

Applies on top of step 1 (`tokens.css`), step 2 (`AppBar`, `TabBar`, `Sheet`, `Keypad`)
and step 3 (`/`). Markup, routing, state and logic untouched; every edit is inside an
existing CSS rule except the four marked **new rule**.

## The one new law: the pocket

Step 3 withdrew shadows from resting surfaces. This step withdraws the last four
`inset` shadows, which were doing the opposite job — pressing something *into* a card.
They are replaced by one pair of tokens, so recession means the same thing everywhere
and in both themes:

| role inside a card | token | dark | light |
| --- | --- | --- | --- |
| recessed (well) | `--ground-2` | `#0c0c0e` | `#e8e8ec` |
| raised | `--raised` | `#2a2a2c` | `#ffffff` |

Applied to: the gap day in the tape, the goal's `why`, the theme segment track, every
meter track, every field. No new token, no new hex.

## Weight ladder

The last seven `font-weight: 500` in the app are gone. Reading value → 600, context → 400.

---

## src/lib/styles/app.css

```css
/* .field__input — a field is a well, and a well is 8px utility, not a card */
.field__input {
	min-height: var(--touch); /* was var(--touch-lg) — 54 → 44; the 10 px goes to the hint */
	border-radius: var(--radius-sm); /* was var(--radius-md) */
	background: var(--ground-2); /* was var(--surface-2) */
}
```

## src/routes/tape/+page.svelte

```css
.balance,
.month {
	box-shadow: var(--edge); /* was var(--edge), var(--elev-1) — same result, plainer */
}

/* NEW RULE — the balance is the one number this screen exists to answer, so it
   takes the display size and sits under the thumb, on the right. */
.balance {
	text-align: right;
}

.balance__name {
	text-align: left; /* the account name stays a left-hand label */
}

/* NEW RULE — 2xl (28) → 3xl (34). The Money prop stays `size="2xl"`; markup is
   not touched, the slab overrides it. */
.balance :global(.money) {
	font-size: var(--text-3xl);
	letter-spacing: var(--track-display);
}

/**
 * A hole is a pocket, not a shadow. `--ground-2` is darker than the card in both
 * themes, so "pressed in" reads the same way with the lights on and off.
 */
.day--gap {
	background: var(--ground-2); /* was var(--surface-2) */
	/* box-shadow: inset 0 1px 3px rgb(0 0 0 / 12%);  DELETE */
}

/* The press has to go *up* from the pocket now, not further down. */
.blank:active {
	background: var(--surface-2); /* was var(--surface-3) */
}
@media (hover: hover) {
	.blank:hover {
		background: var(--surface-2); /* was var(--surface-3) */
	}
}
```

`.row` keeps its background flash and gets **no** `scale(0.95)`. The press contract is
for buttons the size of a button; scaling a full-bleed row by 5 % shows the ground
through its own corners.

## src/routes/mesic/+page.svelte

```css
.card {
	box-shadow: var(--edge); /* was var(--edge), var(--elev-1) */
}

.finding__title {
	font-weight: 600; /* was 500 */
}

/* the shared meter — same pocket as everywhere else */
.meter {
	background: var(--ground-2); /* was var(--surface-3) */
}
```

`Doughnut`'s default track is already `var(--split-left)`; the ghost segment and the
`track="transparent"` on the target ring are design decisions that survive unchanged.

## src/routes/cil/+page.svelte

```css
.card {
	box-shadow: var(--edge); /* was var(--edge), var(--elev-1) */
}

/* The why is the one thing on this screen he wrote himself: set into the card,
   not floating on it. Recession by luminance, no inset. */
.why {
	background: var(--ground-2); /* was var(--surface-2) */
	/* box-shadow: inset 0 1px 3px rgb(0 0 0 / 10%);  DELETE */
}

.meter {
	background: var(--ground-2); /* was var(--surface-3) */
}
```

`Odložit` is `.btn--primary` and therefore already the pill (step 3). `Upravit cíl
měsíce` stays `--radius-md`: two buttons of equal size are told apart by shape, which
is the whole reason the pill is reserved.

## src/routes/settings/+page.svelte

```css
.card {
	box-shadow: var(--edge); /* was var(--edge), var(--elev-1) */
}

/* ── the theme segments ── the track is the pocket, the selection is raised */
.segments {
	background: var(--ground-2); /* was var(--surface-2) */
}

.segment {
	font-weight: 400; /* was 500 */
	transition:
		background var(--dur-base) var(--ease-out),
		color var(--dur-base) var(--ease-out);
	/* box-shadow transition: DELETE — there is no shadow left to animate */
}

.segment--on {
	background: var(--raised); /* was var(--surface) */
	/* box-shadow: DELETE both lines */
}

.link {
	font-weight: 600; /* was 500 */
}
```

Dark: `#0c0c0e → #2a2a2c`. Light: `#e8e8ec → #ffffff`. One rule, luminance in both
directions.

## src/lib/ui — the last of the 500s

```css
/* RefileSheet.svelte  .target (the chip) */
font-weight: 400; /* was 500 */

/* HoldingSheet.svelte, ScheduleSheet.svelte, ValuationSheet.svelte */
font-weight: 400; /* was 500 */

/* GoalStrip.svelte  .strip__name — already patched in step 3, listed for the count */
```

## src/lib/ui/MonthTotals.svelte

```css
.totals {
	box-shadow: var(--edge); /* was var(--edge), var(--elev-1) */
}
```

## Untouched on purpose

- `Doughnut.svelte`, `Money.svelte`, `DueStrip.svelte`, `Icon.svelte` — zero diff. Every
  shadow is already a token and no 500 exists.
- `Sheet.svelte`, `Toaster.svelte` — `--elev-sheet` / `--elev-3` stay. These layers
  genuinely float over content; that is the one case the shadow was kept for.
- `Scenery.svelte` — the two shadows there are the scenery, not furniture.
- The `--flag` strip on a stale holding in `/jmeni` is the DueStrip grammar reused, not
  a new pattern: wash, 1 px edge, dot, one-word action.
- `/settings` cards Pravidelné platby, Jmění and Synchronizace: same row / field /
  secondary-button grammar as the three shown. No screen-specific decision, so no diff
  beyond the `.card` and `.field__input` rules above.
