# Step 3b — height budget for `/`, ladder rewrite

Applies on top of step-3.md. All CSS-only. The keypad key clamp
`min-height: clamp(var(--touch), 6.4dvh, 56px)` is UNTOUCHED. The "větší
clamp" note in rev A referred to `--text-display` and is withdrawn — below
860px the ladder overrides it anyway, and above 860px there is slack to spare.
44px stays the hit floor everywhere; what compresses is padding, gaps, and
the amount's font-size — the same direction the ladder already ran.

## The problem, in numbers

At 375px wide with the current source (≤860 + ≤700 steps active), fixed
vertical cost sums to ~683px against the SE's 667. The rewrite below removes
exactly 18px, all from air, none from targets.

## Vertical budget at 375 × 667 (≤860 + ≤700 active, after this patch)

| block                                   | px  |
|-----------------------------------------|-----|
| month slab (8 mt + 2 border + 4/4 pad + 24 head + 4 + 40 body + 4+1 rule + 36 goal strip) | 127 |
| due strip (44 + 4 mb)                   | 48  |
| amount display floor (4/4 pad + 38 coin)| 46  |
| context (2 pt + 24 chips + 8 + 47 meta + 8 + 45 extras + 4 pb) | 138 |
| checks strip (44 + 4 mb)                | 48  |
| pad (2 border + 16 pad + 188 keys(4×44+3×4) + 4 + 44 save + 4 mb) | 258 |
| **total fixed**                         | **665 / 667** |

2px slack → `.display` (flex: 1) absorbs it. Nothing scrolls, nothing clips.

Same accounting at the other two artboards:
- **393 × 759** (≤860 only): 150 + 52 + 54 + 148 + 52 + 298 = **754 / 759**
  (keys at 6.4dvh = 48px — clamp untouched; 5px slack → display).
- **393 × 460** (≤860 + ≤700 + ≤480): 38 + 121 + 48 + 244 = **451 / 460**
  (totals + due strip below the fold via `order: 1`; 9px slack → display).

## Ladder diff

### src/routes/+page.svelte

```css
@media (max-height: 860px) {
	.context {
		padding-top: var(--space-1);
		padding-bottom: var(--space-2); /* NEW — was base space-3 */
	}
	/* rest of the step unchanged */
}

@media (max-height: 700px) {
	.context {
		gap: var(--space-2);                 /* NEW — was calc(--control-gap/2) = 10 */
		padding-block: 2px var(--space-1);   /* was 2px var(--space-2) */
	}
	.save {
		min-height: var(--touch);
		margin-top: var(--space-1);          /* was var(--space-2) */
	}
	.checks {
		margin-bottom: var(--space-1);       /* NEW — was base space-2 */
	}
	/* .display__amount 32px cap, .coin 38 + ::after — unchanged */
}

@media (max-height: 480px) {
	.totals-slot { order: 1; }               /* unchanged */
	/* NEW: the due strip is ledger business, same as the totals — it joins
	   them below the fold. One swipe away, same reading order in the DOM. */
	.flow > :global(.due-strip) { order: 1; }
	.display { padding-block: 0; }
	/* Rare props drawn at --control, hit at 44 via the ::after every other
	   small control in the app already uses. */
	.extras { padding-top: var(--space-1); }
	.prop { min-height: var(--control); }
	.prop::after { inset: -10px 0; }
	.pad { padding: var(--space-1); }
}

/* landscape split (max-height: 560px) and (min-width: 34rem) — UNCHANGED */
```

### src/lib/ui/MonthTotals.svelte

```css
@media (max-height: 700px) {
	.totals__rule { margin-top: var(--space-1); } /* NEW — was step-860's space-2 */
}
```

### src/lib/ui/DueStrip.svelte

```css
@media (max-height: 700px) {
	.due-strip { margin-bottom: var(--space-1); } /* NEW — was space-2 */
}
```

### src/lib/ui/Keypad.svelte

```css
@media (max-height: 480px) {
	.keypad { gap: 2px; } /* gutters close further; keys stay 44 */
}
/* .key min-height clamp — NOT TOUCHED */
```

## What compresses at each step (the ladder, restated)

- **≤860** — outer air: slab padding, display padding, pad padding/margins,
  meters hidden, save 48. NEW: context pb 12 → 8.
- **≤700** — type: amount 32px cap, net 22px, caption gone, coin 38 (hit 44).
  NEW: context gap 10 → 8, pb 4; save mt 4; due/checks mb 4; totals rule mt 4.
- **≤480** — reordering: totals AND (new) due strip below the fold; display
  padding 0; props drawn 24 hit 44; pad padding 4; keypad gap 2.
- **landscape** — unchanged two-column split.

## Touch floor audit (44px at every height)

keys 44 · save 44 · due strip 44 · checks 44 · meta well 47 · payee 47/16px
font (Safari zoom floor) · chips drawn 24 → hit 46 (rail padding-block, as
today) · props drawn 37/24 → hit 45/44 (::after) · coin drawn 38 → hit 44
(::after, existing ≤700 rule) · icon links 44 (negative-margin pull only).
