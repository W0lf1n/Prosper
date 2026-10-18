<script lang="ts">
	/**
	 * Tempo útraty — what this month has cost so far, as a line climbing
	 * through the days, over last month's whole line (`domain/charts.ts` →
	 * `spendPace`, `docs/CHARTS.md` §d1).
	 *
	 * The sentence is the chart's point and comes first: so much more or less
	 * than last month by the same day. The plot is the evidence under it.
	 * Two series, so a legend; this month's line is ink and ends in a dot with
	 * its figure, last month's is the quiet ink and solid — a dashed line
	 * would read as a forecast. A finger on the plot reads both on that day.
	 */
	import type { SpendPace } from '$lib/domain/charts';
	import { ZERO, abs, formatMoney } from '$lib/domain/money';

	interface Props {
		pace: SpendPace;
		code: string;
	}

	let { pace, code }: Props = $props();

	const HEIGHT = 120;
	const PAD = 8;

	let width = $state(300);
	let scrub = $state<number | null>(null);

	const now = $derived(pace.current.at(-1)?.total ?? ZERO);
	const top = $derived(
		Math.max(1, now, pace.previous.at(-1)?.total ?? 0, ...pace.current.map((p) => p.total))
	);
	const span = $derived(Math.max(1, pace.days - 1));

	const x = (day: number) => ((day - 1) / span) * width;
	const y = (total: number) => HEIGHT - PAD - (total / top) * (HEIGHT - 2 * PAD);

	function path(points: { day: number; total: number }[]): string {
		return points
			.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.total).toFixed(1)}`)
			.join(' ');
	}

	const sentence = $derived.by(() => {
		if (pace.delta === null) return 'Minulý měsíc tu ještě nic nebylo — není s čím srovnat.';
		if (pace.delta === 0) return 'Přesně jako minulý měsíc ke stejnému dni.';
		const by = formatMoney(abs(pace.delta), { code });
		return pace.delta < 0
			? `O ${by} méně než minulý měsíc ke stejnému dni.`
			: `O ${by} víc než minulý měsíc ke stejnému dni.`;
	});

	const reading = $derived.by(() => {
		if (scrub === null) return null;
		const mine = pace.current.find((p) => p.day === scrub);
		const theirs = pace.previous.find((p) => p.day === scrub);
		return { day: scrub, mine: mine?.total ?? null, theirs: theirs?.total ?? null };
	});

	function track(event: PointerEvent) {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const day = Math.round(((event.clientX - box.left) / box.width) * span) + 1;
		scrub = Math.min(pace.days, Math.max(1, day));
	}

	function key(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const from = scrub ?? pace.today;
		scrub = Math.min(pace.days, Math.max(1, from + (event.key === 'ArrowLeft' ? -1 : 1)));
	}
</script>

<section class="card">
	<h2 class="label">Tempo útraty</h2>

	<div class="pace__figure">
		{#if reading}
			<span class="pace__big">
				{reading.mine === null ? '—' : formatMoney(reading.mine, { code })}
			</span>
			<span class="pace__sub">
				do {reading.day}. · minulý měsíc {reading.theirs === null
					? '—'
					: formatMoney(reading.theirs, { code })}
			</span>
		{:else}
			<span class="pace__big">{formatMoney(now, { code })}</span>
			<span
				class="pace__sub"
				class:pace__sub--less={pace.delta !== null && pace.delta < 0}
				class:pace__sub--more={pace.delta !== null && pace.delta > 0}>{sentence}</span
			>
		{/if}
	</div>

	<div class="pace__plot" bind:clientWidth={width}>
		<svg
			{width}
			height={HEIGHT}
			role="slider"
			tabindex="0"
			aria-label="Tempo útraty po dnech"
			aria-valuemin={1}
			aria-valuemax={pace.days}
			aria-valuenow={scrub ?? pace.today}
			aria-valuetext={reading
				? `${reading.day}. den: ${reading.mine === null ? 'bez údaje' : formatMoney(reading.mine, { code })}`
				: `${formatMoney(now, { code })}. ${sentence}`}
			onfocus={() => (scrub ??= pace.today)}
			onpointermove={track}
			onpointerdown={track}
			onpointerleave={() => (scrub = null)}
			onkeydown={key}
			onblur={() => (scrub = null)}
		>
			<line class="pace__base" x1="0" x2={width} y1={HEIGHT - PAD} y2={HEIGHT - PAD} />
			{#if pace.previous.length > 0}
				<path class="pace__last" d={path(pace.previous)} />
			{/if}
			{#if pace.current.length > 0}
				<path class="pace__this" d={path(pace.current)} />
				<circle class="pace__dot" cx={x(pace.today)} cy={y(now)} r="4" />
			{/if}
			{#if scrub !== null}
				<line class="pace__cross" x1={x(scrub)} x2={x(scrub)} y1="0" y2={HEIGHT} />
			{/if}
		</svg>
		<div class="pace__axis" aria-hidden="true">
			<span>1.</span>
			<span>{Math.round(pace.days / 2)}.</span>
			<span>{pace.days}.</span>
		</div>
	</div>

	<div class="pace__legend">
		<span class="pace__key"><span class="pace__swatch pace__swatch--this"></span>tento měsíc</span>
		<span class="pace__key"><span class="pace__swatch pace__swatch--last"></span>minulý měsíc</span>
	</div>
</section>

<style>
	.pace__figure {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 52px;
	}

	.pace__big {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.pace__sub {
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.pace__sub--less {
		color: var(--in);
	}

	.pace__sub--more {
		color: var(--flag);
	}

	.pace__plot {
		width: 100%;
		touch-action: pan-y;
	}

	svg {
		display: block;
		overflow: visible;
		outline: none;
	}

	.pace__base {
		stroke: var(--hairline);
		stroke-width: 1;
	}

	.pace__last,
	.pace__this {
		fill: none;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.pace__last {
		stroke: var(--ink-3);
		opacity: 0.6;
	}

	.pace__this {
		stroke: var(--ink);
	}

	.pace__dot {
		fill: var(--ink);
		stroke: var(--surface);
		stroke-width: 2;
	}

	.pace__cross {
		stroke: var(--hairline-2);
		stroke-width: 1;
	}

	.pace__axis {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.pace__legend {
		display: flex;
		gap: var(--space-4);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.pace__key {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.pace__swatch {
		width: 14px;
		height: 2px;
		border-radius: 1px;
	}

	.pace__swatch--this {
		background: var(--ink);
	}

	.pace__swatch--last {
		background: var(--ink-3);
		opacity: 0.6;
	}
</style>
