<script lang="ts">
	/**
	 * Rozdělení příjmu as four meters (`prosperity.ts` → `splitBars`,
	 * `docs/CHARTS.md` §b).
	 *
	 * The ring on Přehled asked the reader to compare four arcs, a percentage
	 * in the hole and a column of signed deltas — three encodings for one
	 * question, and nobody read it. This asks the question the law asks, once
	 * per class: how far from the book's share, in koruny. The meter is the
	 * one every screen already uses for "how far along"; the line under it
	 * says what is missing, or that it is done, in words.
	 */
	import { resolve } from '$app/paths';
	import { formatMoney, type Minor } from '$lib/domain/money';
	import { splitBars, verdict, type BarState, type ProsperitySplit } from '$lib/domain/prosperity';
	import Explainer from './Explainer.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		split: ProsperitySplit;
		code: string;
	}

	let { split, code }: Props = $props();

	const bars = $derived(splitBars(split));

	const TONE: Record<BarState, string | undefined> = {
		met: 'done',
		within: 'done',
		short: undefined,
		over: 'behind'
	};

	function status(state: BarState, gap: Minor): string {
		const money = formatMoney(gap, { code });
		switch (state) {
			case 'met':
				return 'splněno';
			case 'short':
				return `chybí ${money}`;
			case 'within':
				return `zbývá ${money}`;
			case 'over':
				return `o ${money} přes`;
		}
	}
</script>

<section class="card">
	<div class="card__head">
		<h2 class="label">
			<Explainer term="Rozdělení příjmu">
				<p>
					Z každé koruny příjmu: 10 % dávání, 10 % spoření, 10 % dluhy nebo rezerva, 70 % život.
					Každý řádek ukazuje, kolik z podílu tenhle měsíc máš — a kolik chybí nebo zbývá, v
					korunách.
				</p>
			</Explainer>
		</h2>
		<a class="link" href={resolve('/rozdeleni')}>Naplánovat</a>
	</div>

	<p class="split__verdict">{verdict(split)}</p>

	{#if split.hasIncome}
		<ul class="split__rows">
			{#each bars as bar (bar.cls)}
				<li class="split__row">
					<div class="split__head">
						<span class="split__name">{bar.label}</span>
						<span class="split__of">
							{formatMoney(bar.amount, { currency: false })} z {formatMoney(bar.mark, { code })}
						</span>
					</div>
					<div
						class="meter"
						role="meter"
						aria-label={bar.label}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={bar.fill}
						aria-valuetext="{bar.percent} % příjmu, {status(bar.state, bar.gap)}"
					>
						<span class="meter__fill" data-tone={TONE[bar.state]} style="width: {bar.fill}%"></span>
					</div>
					<span class="split__status">
						{#if bar.state === 'met' || bar.state === 'within'}
							<span class="split__ok"><Icon name="check" size={13} stroke={2.6} /></span>
						{/if}
						{status(bar.state, bar.gap)}
					</span>
				</li>
			{/each}
		</ul>
		<p class="hint">
			Příjem {formatMoney(split.income, { code })} ·
			{split.left < 0 ? 'přečerpáno' : 'zbylo'}
			{formatMoney(split.left, { sign: 'never', code })} ({Math.abs(split.leftPercent)} %)
		</p>
	{/if}
</section>

<style>
	.split__verdict {
		font-size: var(--text-base);
		font-weight: 600;
		line-height: var(--leading-base);
	}

	.split__rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.split__row {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.split__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.split__name {
		font-size: var(--text-base);
		font-weight: 600;
	}

	.split__of {
		font-size: var(--text-sm);
		color: var(--ink-2);
		white-space: nowrap;
	}

	.split__status {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.split__ok {
		color: var(--in);
	}
</style>
