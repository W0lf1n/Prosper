<script lang="ts">
	/**
	 * Vývoj zůstatku — the balance of the active currency over a day, a week,
	 * a month, a year, or everything (`domain/charts.ts` → `balanceSeries`,
	 * `docs/CHARTS.md` §c).
	 *
	 * The shape a trading app taught everybody to read: the figure on top, what
	 * the range did to it under the figure, one line with a wash beneath it,
	 * and a hairline at where the range began so up and down read at a glance.
	 * A finger on the line moves a crosshair and the figure follows it. The
	 * range is the card's own pill — it scopes this one chart and nothing else.
	 */
	import {
		BALANCE_RANGES,
		RANGE_LABEL,
		RANGE_SINCE,
		balanceScopes,
		balanceSeries,
		type BalanceRange
	} from '$lib/domain/charts';
	import Icon from './Icon.svelte';
	import { capitalize } from '$lib/domain/czech';
	import { formatDayHeading, type IsoDate } from '$lib/domain/datetime';
	import { formatMoney } from '$lib/domain/money';
	import type { Account, Txn } from '$lib/domain/types';

	interface Props {
		accounts: readonly Account[];
		txns: readonly Txn[];
		currency: string;
		today: IsoDate;
	}

	let { accounts, txns, currency, today }: Props = $props();

	const HEIGHT = 140;
	const PAD = 10;

	let range = $state<BalanceRange>('month');
	let width = $state(300);
	let scrub = $state<number | null>(null);

	/**
	 * Which line: the active currency's accounts together, to begin with; a
	 * tap on the pill in the corner steps to the next account or currency.
	 * Held as an index, so a switch of the active account on Zápis — which
	 * moves `currency` — starts the list over from that currency.
	 */
	const scopes = $derived(balanceScopes(accounts, currency));
	let step = $state(0);
	const scope = $derived(scopes[step % scopes.length]!);

	$effect(() => {
		void currency;
		step = 0;
	});

	const series = $derived(
		balanceSeries({
			accounts,
			txns,
			currency: scope.currency,
			accountId: scope.accountId,
			range,
			today
		})
	);
	const code = $derived(scope.currency);

	function nextScope() {
		step = (step + 1) % scopes.length;
		scrub = null;
	}
	const count = $derived(series.points.length);

	const x = (index: number) => (count <= 1 ? 0 : (index / (count - 1)) * width);
	const y = (value: number) => {
		const low = series.low as number;
		const high = series.high as number;
		const spread = high - low || Math.max(1, Math.abs(high));
		return PAD + (1 - (value - low) / spread) * (HEIGHT - 2 * PAD);
	};

	const line = $derived(
		series.points
			.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
			.join(' ')
	);
	const area = $derived(`${line} L${width},${HEIGHT} L0,${HEIGHT} Z`);

	const shown = $derived(scrub !== null ? series.points[scrub] : null);

	function when(at: string): string {
		// The day range is moments; every other range is days.
		if (at.length > 10) {
			const time = at.slice(11, 16);
			return time === '00:00' ? 'začátek dne' : time === '23:59' ? 'dnes' : `dnes ${time}`;
		}
		return capitalize(formatDayHeading(at, today));
	}

	function track(event: PointerEvent) {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const index = Math.round(((event.clientX - box.left) / box.width) * (count - 1));
		scrub = Math.min(count - 1, Math.max(0, index));
	}

	function key(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const from = scrub ?? count - 1;
		scrub = Math.min(count - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1)));
	}

	function choose(next: BalanceRange) {
		range = next;
		scrub = null;
	}
</script>

<section class="card">
	<div class="card__head">
		<h2 class="label">Vývoj zůstatku</h2>
		{#if scopes.length > 1}
			<button
				type="button"
				class="btn btn--sm bal__scope"
				aria-label="Účet: {scope.label}. Ťukni pro další"
				onclick={nextScope}
			>
				<span class="bal__scope-name">{scope.label}</span>
				<Icon name="repeat" size={14} stroke={2} />
			</button>
		{:else}
			<span class="label">{scope.label}</span>
		{/if}
	</div>

	<div class="bal__figure">
		<span class="bal__big">{formatMoney(shown?.value ?? series.last, { code })}</span>
		{#if shown}
			<span class="bal__sub">{when(shown.at)}</span>
		{:else}
			<span class="bal__sub" class:bal__sub--up={series.change > 0}>
				{formatMoney(series.change, {
					sign: series.change === 0 ? 'never' : 'always',
					code
				})}
				{series.clamped ? 'od začátku' : RANGE_SINCE[range]}
			</span>
		{/if}
	</div>

	<div class="seg seg--soft" role="group" aria-label="Období">
		{#each BALANCE_RANGES as option (option)}
			<button
				type="button"
				class="seg__item"
				aria-pressed={range === option}
				onclick={() => choose(option)}
			>
				{RANGE_LABEL[option]}
			</button>
		{/each}
	</div>

	<div class="bal__plot" bind:clientWidth={width}>
		<svg
			{width}
			height={HEIGHT}
			role="slider"
			tabindex="0"
			aria-label="Zůstatek v čase"
			aria-valuemin={0}
			aria-valuemax={Math.max(0, count - 1)}
			aria-valuenow={scrub ?? count - 1}
			aria-valuetext={shown
				? `${when(shown.at)}: ${formatMoney(shown.value, { code })}`
				: `${formatMoney(series.last, { code })}, ${formatMoney(series.change, { sign: 'always', code })} ${series.clamped ? 'od začátku' : RANGE_SINCE[range]}`}
			onpointermove={track}
			onpointerdown={track}
			onpointerleave={() => (scrub = null)}
			onkeydown={key}
			onblur={() => (scrub = null)}
		>
			<line class="bal__start" x1="0" x2={width} y1={y(series.first)} y2={y(series.first)} />
			<path class="bal__area" d={area} />
			<path class="bal__line" d={line} />
			{#if shown && scrub !== null}
				<line class="bal__cross" x1={x(scrub)} x2={x(scrub)} y1="0" y2={HEIGHT} />
				<circle class="bal__dot" cx={x(scrub)} cy={y(shown.value)} r="4" />
			{:else}
				<circle class="bal__dot" cx={x(count - 1)} cy={y(series.last)} r="4" />
			{/if}
		</svg>
		<div class="bal__axis" aria-hidden="true">
			<span>{when(series.points[0]!.at)}</span>
			<span>dnes</span>
		</div>
	</div>
</section>

<style>
	.bal__figure {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.bal__big {
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: var(--track-3xl);
		line-height: var(--leading-tight);
	}

	.bal__sub {
		min-height: 1.4em;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.bal__sub--up {
		color: var(--in);
	}

	/* The pill names what is drawn; a quiet one, so the figure stays first. */
	.bal__scope {
		max-width: 60%;
	}

	.bal__scope-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bal__plot {
		width: 100%;
		touch-action: pan-y;
	}

	svg {
		display: block;
		overflow: visible;
		outline: none;
	}

	.bal__start {
		stroke: var(--hairline);
		stroke-width: 1;
	}

	.bal__area {
		fill: var(--ink-wash);
	}

	.bal__line {
		fill: none;
		stroke: var(--ink);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.bal__cross {
		stroke: var(--hairline-2);
		stroke-width: 1;
	}

	.bal__dot {
		fill: var(--ink);
		stroke: var(--surface);
		stroke-width: 2;
	}

	.bal__axis {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}
</style>
