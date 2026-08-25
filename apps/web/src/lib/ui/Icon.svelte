<script lang="ts" module>
	/**
	 * The icon set.
	 *
	 * Drawn here rather than pulled from a library, for the same reason the ring
	 * on the month screen is drawn by hand: there are eleven shapes in this app
	 * and a dependency would cost more than it saves. What matters is that they
	 * are one set — one grid, one stroke weight, one cap — because mismatched
	 * stroke widths are the fastest way to make an interface look assembled.
	 *
	 * Grid 24. Stroke 1.6, round cap, round join. Fills only for dots.
	 */
	const PATHS = {
		/** Back. The only navigation glyph that points anywhere. */
		back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
		'chevron-left': '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
		'chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',

		/** Výpis — a till roll, torn off at the bottom. */
		tape: '<path d="M6.5 3.7h11v16.6l-1.83-1.35-1.84 1.35-1.83-1.35-1.84 1.35-1.83-1.35L6.5 20.3Z"/><path d="M9.7 8.3h4.6M9.7 11.9h4.6"/>',

		/** Měsíc — the 10/10/10/70 ring itself, at 24 px. */
		month:
			'<circle cx="12" cy="12" r="7.4" stroke-dasharray="33.5 13" transform="rotate(-90 12 12)"/>',

		/** Cíl — a target, because that is the law it belongs to. */
		goal: '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',

		/** Nastavení — sliders, not a gear. This is an instrument; it gets tuned. */
		settings:
			'<path d="M3.8 7.6h4.4M13.2 7.6h7M3.8 16.4h7.4M16.2 16.4h4"/><circle cx="10.7" cy="7.6" r="2.2"/><circle cx="13.7" cy="16.4" r="2.2"/>',

		plus: '<path d="M12 6.4v11.2M6.4 12h11.2"/>',
		search: '<circle cx="11" cy="11" r="6.3"/><path d="m15.7 15.7 3.8 3.8"/>',
		close: '<path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4"/>',

		/** Smazat číslici. The notch points at the digit it will remove. */
		backspace:
			'<path d="M9.3 5.4h9.1a1.7 1.7 0 0 1 1.7 1.7v9.8a1.7 1.7 0 0 1-1.7 1.7H9.3L3.6 12Z"/><path d="m12.1 9.7 4.6 4.6m0-4.6-4.6 4.6"/>',

		'arrow-down': '<path d="M12 5.2v13.4M6.9 13.5 12 18.6l5.1-5.1"/>',
		'arrow-up': '<path d="M12 18.8V5.4M6.9 10.5 12 5.4l5.1 5.1"/>',
		check: '<path d="m5.6 12.4 4.4 4.4 8.4-9.6"/>',

		/**
		 * Jmění — a stack, narrowing as it rises.
		 *
		 * Not a coin and not a bank: both are pictures of money in general, and
		 * this screen is about an amount that has been piled up. Three slabs on
		 * the same centre line, in the same rounded language as the app's own
		 * surfaces.
		 */
		wealth:
			'<rect x="3.8" y="15.6" width="16.4" height="4.6" rx="2.3"/><rect x="5.9" y="9.8" width="12.2" height="4.6" rx="2.3"/><rect x="8" y="4" width="8" height="4.6" rx="2.3"/>',

		/** Označit den bez výdaje — a day closed with nothing in it. */
		'zero-day':
			'<rect x="4.2" y="5.4" width="15.6" height="14.4" rx="2.4"/><path d="M4.2 10h15.6M8.6 3.6v3.2M15.4 3.6v3.2"/><path d="m9.9 14.9 4.2 0"/>'
	} as const;

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		/** Rendered pixel size. The grid is 24, so anything else scales the stroke. */
		size?: number;
		/** Optical weight. Nav and hero glyphs carry a touch more. */
		stroke?: number;
	}

	let { name, size = 22, stroke = 1.6 }: Props = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a closed set of literals declared above -->
	{@html PATHS[name]}
</svg>

<style>
	svg {
		display: block;
		flex: none;
		/* Stroke geometry is drawn on a half-pixel grid; let the browser keep it. */
		shape-rendering: geometricPrecision;
	}
</style>
