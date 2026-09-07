# Step 2 — base components, visual layer only

Applies on top of step 1 (`tokens.css`). CSS-only changes inside existing rules;
markup and logic untouched. Reference preview: `Base Components.dc.html`.

## src/lib/ui/AppBar.svelte

```css
/* The screen title takes the display treatment — this is the only place on a
   phone screen where a heading has room to be one. */
.bar h1 {
	font-size: var(--text-2xl); /* was var(--text-xl) — 22 → 28 */
	font-weight: 700; /* was 600 */
	letter-spacing: var(--track-display); /* was var(--track-tight) */
}

/* Short screens (the existing 48px bar) keep the old size — 28 px in a 48 px bar
   is a title wearing the bar. */
@media (max-height: 560px) {
	.bar h1 {
		font-size: var(--text-xl); /* was var(--text-lg) */
		font-weight: 600;
		letter-spacing: var(--track-tight);
	}
}
```

`/mesic` passes its own `heading` snippet (the month switcher) and is unaffected: that
`h1` stays `--text-xl` / 600, because it sits between two 44 px chevrons.

## src/lib/ui/TabBar.svelte

```css
/* The bar is furniture, not a floating layer: surface luminance and one hairline
   are the whole separation. */
.tabbar {
	box-shadow: var(--edge); /* was var(--edge), 0 -6px 24px rgb(0 0 0 / 10%) */
}

.tab__label {
	font-weight: 400; /* was 500 */
}

/* The press contract: scale(0.95), everywhere, one number. */
.tab:active .tab__glyph {
	transform: scale(0.95); /* was scale(0.9) */
}

/* The record disc is flat. It is already the only filled shape in the bar and the
   only pill-round thing on the screen; a glow on top of that is saying it twice. */
.record__disc {
	/* box-shadow: DELETE all three lines */
	transition: transform var(--dur-press) var(--ease-out);
	/* box-shadow transition: DELETE */
}

.record:active .record__disc {
	transform: scale(0.95); /* was scale(0.93) */
	/* box-shadow: DELETE both lines */
}

@media (hover: hover) {
	.record:hover .record__disc {
		filter: brightness(1.06); /* replaces the translateY + two shadows */
		/* transform: DELETE */
		/* box-shadow: DELETE all three lines */
	}
}
```

## src/lib/ui/Keypad.svelte

```css
/* A key is raised by being lighter than the pad, not by a drop shadow. */
.key {
	box-shadow: var(--edge); /* was var(--edge), 0 1px 2px rgb(0 0 0 / 12%) */
	transition:
		background var(--dur-press) var(--ease-out),
		transform var(--dur-press) var(--ease-out);
	/* box-shadow transition: DELETE */
}

/* One press, one property. The key scales; the glyph inside it no longer scales
   separately, which was two presses fighting over 90 ms. */
.key:active {
	background: var(--surface-3);
	transform: scale(0.95); /* was translateY(1px) */
	/* box-shadow: inset 0 1px 3px rgb(0 0 0 / 22%);  DELETE */
}

/* .key:active .key__face — DELETE the whole rule (was transform: scale(0.94)) */

.key--aux:active {
	background: var(--surface-2);
	/* box-shadow: inset 0 1px 3px rgb(0 0 0 / 18%);  DELETE */
}
```

`min-height: clamp(var(--touch), 6.4dvh, 56px)` is untouched, in this step and every
later one. The keypad's height ladder is settled — see `patches/step-3b-height.md`.

## src/lib/ui/Sheet.svelte

Zero diff. A sheet genuinely floats over content, so `--edge-strong, --elev-sheet` and
the wide-screen `--edge, --elev-3` are the one case the shadow was kept for. The grip,
the `min(88dvh, …)` cap and the ≥35rem centred-panel behaviour all survive unchanged.
