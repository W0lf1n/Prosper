# Step 3 — `/` (keypad home), visual layer only

Applies on top of step 1 (`tokens.css`) and step 2 (`AppBar`, `TabBar`, `Sheet`, `Keypad`).
Every edit below is a CSS-only change inside an existing rule; markup and logic untouched.
Principle: shadows withdrawn from resting surfaces (luminance is the elevation),
pill reserved for the primary action, weight ladder 400/600/700.

## src/lib/styles/app.css

```css
/* .btn — the ladder has no 500; press is the system scale */
.btn {
	font-weight: 400; /* was 500 */
}
.btn:active {
	transform: scale(0.95); /* was 0.98 */
}

/* .btn--primary — THE pill. Flat signal fill, no glow, no inset. */
.btn--primary {
	background: var(--signal);
	border-color: var(--signal);
	color: var(--signal-ink);
	font-weight: 600;
	border-radius: var(--radius-full); /* new — pill is the action signal */
	/* box-shadow: DELETE all three lines */
}
.btn--primary:active {
	/* box-shadow: DELETE — scale(0.95) from .btn:active is the whole press */
}
@media (hover: hover) {
	.btn--primary:hover {
		background: var(--signal);
		border-color: var(--signal);
		filter: brightness(1.06); /* replaces the shadow lift */
	}
}

/* .field__label */
.field__label {
	font-weight: 400; /* was 500 */
}
```

## src/routes/+page.svelte

```css
/* .meta — a well is recessed by its surface, not by an inset shadow */
.meta {
	/* box-shadow: inset 0 1px 2px rgb(0 0 0 / 16%);  DELETE */
}
.meta:focus-within {
	border-color: var(--signal);
	box-shadow: 0 0 0 3px var(--signal-wash); /* inset part deleted */
}

/* .meta__date */
.meta__date {
	font-weight: 600; /* was 500 */
	box-shadow: var(--edge); /* was var(--edge), var(--elev-1) — same result, plainer */
}

/* .coin — the wash and the hairline carry it; the glow goes */
.coin {
	box-shadow: var(--edge-strong); /* drop `0 2px 12px var(--danger-edge)` */
}
.coin--in {
	box-shadow: var(--edge-strong); /* drop `0 2px 12px var(--signal-edge)` */
}

/* .prop */
.prop {
	font-weight: 400; /* was 500 */
}
.prop__track {
	/* box-shadow: inset 0 1px 2px rgb(0 0 0 / 26%);  DELETE */
}
.prop--on .prop__track {
	background: var(--signal);
	/* box-shadow: DELETE */
}

/* .save — the primary action becomes the pill; flat, pressed by scale */
.save {
	border-radius: var(--radius-full); /* was var(--radius-md) */
	/* box-shadow: DELETE all three lines */
}
.save:active {
	transform: scale(0.95); /* was scale(0.985) translateY(1px) */
	/* box-shadow: DELETE */
}
.save:disabled {
	background: var(--surface-2);
	color: var(--ink-3);
	cursor: default;
	transform: none;
	/* box-shadow: none — keep */
}

/* .pad — resting furniture, not a floating layer: luminance + hairline only */
.pad {
	box-shadow: var(--edge); /* was var(--edge), var(--elev-3) */
}

/* .checks__row-title */
.checks__row-title {
	font-weight: 600; /* was 500 */
}
```

## src/lib/ui/CategoryPicker.svelte

```css
.chip {
	font-weight: 400; /* was 500 */
}
.chip--on {
	box-shadow: var(--edge-strong); /* drop `0 2px 10px var(--signal-edge)` */
}
```

## src/lib/ui/GoalStrip.svelte

```css
.strip__name {
	font-weight: 400; /* was 500 */
}
```

## Untouched on purpose

- `MonthTotals.svelte`, `DueStrip.svelte` — every shadow there is already a token
  (`--elev-1` is a no-op since step 1) and no weight-500 exists. Zero diff.
- The coin's coral/mint duality, the ambient pools, the checks strip logic — design
  decisions that survive the restyle unchanged.
- After this step `Instrument Sans` has no remaining reference → `/fonts/instrument-sans-*.woff2`
  and its two `@font-face` blocks in app.css can be deleted (−97 kB against the budget).
