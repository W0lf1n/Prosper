<script lang="ts">
	/**
	 * A ring, drawn as one circle per segment with a dash pattern.
	 *
	 * Hand-rolled rather than a chart library (§13.8): there is exactly one
	 * shape here and no axes, ticks or tooltips to buy along with it.
	 *
	 * Segments are drawn from their **exact amounts**, never from the rounded
	 * percentages shown in the legend — otherwise a ring made of 8 %, 9 % and
	 * 84 % would visibly fail to close.
	 */
	import type { Snippet } from 'svelte';

	export interface Segment {
		/** Any non-negative magnitude. Relative size is all that matters. */
		value: number;
		/** A CSS colour — a token, per §13.9. */
		colour: string;
		label: string;
	}

	interface Props {
		segments: Segment[];
		/** Rendered pixel size. The geometry is unitless, so this is the only knob. */
		size?: number;
		/** Ring thickness in viewBox units, out of 100. */
		thickness?: number;
		/** Colour of the ring behind the segments. The soft surface, like every meter. */
		track?: string;
		/** Round the ends. For a single-fill ring, never for a split one. */
		round?: boolean;
		/** Goes in the hole. */
		centre?: Snippet;
		/** For screen readers; the legend carries the same information visually. */
		title: string;
	}

	let {
		segments,
		size = 120,
		thickness = 14,
		track = 'var(--surface-3)',
		round = false,
		centre,
		title
	}: Props = $props();

	const radius = $derived(50 - thickness / 2);
	const circumference = $derived(2 * Math.PI * radius);

	const drawn = $derived.by(() => {
		const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
		if (total <= 0) return [];

		let offset = 0;
		const visible = segments.filter((s) => s.value > 0);

		return visible.map((segment) => {
			const length = (Math.max(0, segment.value) / total) * circumference;
			const start = offset;
			offset += length;
			return { ...segment, dash: length, rest: circumference, offset: -start };
		});
	});
</script>

<div class="doughnut" style="width: {size}px; height: {size}px">
	<svg viewBox="0 0 100 100" role="img" aria-label={title}>
		<circle cx="50" cy="50" r={radius} fill="none" stroke={track} stroke-width={thickness} />
		{#each drawn as segment (segment.label)}
			<circle
				cx="50"
				cy="50"
				r={radius}
				fill="none"
				stroke={segment.colour}
				stroke-width={thickness}
				stroke-dasharray="{segment.dash} {segment.rest}"
				stroke-dashoffset={segment.offset}
				stroke-linecap={round ? 'round' : 'butt'}
			/>
		{/each}
	</svg>

	{#if centre}
		<div class="doughnut__centre">{@render centre()}</div>
	{/if}
</div>

<style>
	.doughnut {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
	}

	svg {
		width: 100%;
		height: 100%;
		/* Start at twelve o'clock rather than three. */
		transform: rotate(-90deg);
	}

	/* Data changes travel round the ring instead of jumping to the new shape. */
	svg circle {
		transition:
			stroke-dasharray var(--dur-slow) var(--ease-out),
			stroke-dashoffset var(--dur-slow) var(--ease-out);
	}

	.doughnut__centre {
		position: absolute;
		inset: 22%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		text-align: center;
		line-height: var(--leading-tight);
	}
</style>
