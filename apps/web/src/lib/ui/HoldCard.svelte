<script lang="ts">
	/**
	 * Blokace — the rows whose amount the bank has only blocked so far (Q75).
	 *
	 * A card on Domů, and only while a hold is open: with none it renders
	 * nothing at all. One slide per row in the same deck as K potvrzení, newest
	 * first, each with *Zaúčtováno* — the figure stood — and *Jiná částka*,
	 * which opens a sheet to type what actually settled. Either way the row
	 * loses its flag in the same write, so the tape stops saying `blokace`.
	 * Tapping the row itself opens the sheet too.
	 */
	import { formatDayHeading } from '$lib/domain/datetime';
	import { formatMoney, parseAmount, abs, neg, type Minor } from '$lib/domain/money';
	import type { Category, Txn } from '$lib/domain/types';
	import Deck from './Deck.svelte';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import { categoryStyle, colorVar } from './palette';

	interface Props {
		holds: Txn[];
		categories: Category[];
		/** Currency of the account these rows are on. */
		code?: string;
		/** `amount` is the settled figure, signed; null keeps the row's own. */
		onsettle: (txn: Txn, amount: Minor | null) => Promise<void>;
	}

	let { holds, categories, code = 'CZK', onsettle }: Props = $props();

	let busy = $state<string | null>(null);
	let editing = $state<Txn | null>(null);
	let typed = $state('');
	let position = $state(0);

	function category(txn: Txn): Category | null {
		return categories.find((c) => c.id === txn.categoryId) ?? null;
	}

	function sub(txn: Txn): string {
		return `${category(txn)?.name ?? '—'} · ${formatDayHeading(txn.date)}`;
	}

	function amountTyped(): Minor | null {
		if (!editing || typed.trim() === '') return null;
		const parsed = parseAmount(typed);
		if (!parsed.ok || parsed.value === 0) return null;
		// The sign belongs to the row; only the magnitude is being corrected.
		return editing.amount < 0 ? neg(abs(parsed.value)) : abs(parsed.value);
	}

	async function settle(txn: Txn, amount: Minor | null) {
		busy = txn.id;
		try {
			await onsettle(txn, amount);
		} finally {
			busy = null;
			editing = null;
			typed = '';
		}
	}
</script>

{#if holds.length > 0}
	<section class="card holds">
		<div class="card__head">
			<h2 class="label">Blokace</h2>
			{#if holds.length > 1}
				<span class="holds__count">{position + 1} z {holds.length}</span>
			{:else}
				<span class="dot dot--warn" aria-hidden="true"></span>
			{/if}
		</div>

		<Deck
			items={holds}
			key={(txn) => txn.id}
			title={(txn) => txn.payee || category(txn)?.name || 'záznam'}
			label="Blokované částky"
			bind:position
		>
			{#snippet slide(txn)}
				{@const style = categoryStyle(category(txn))}
				<button
					type="button"
					class="row row--press holds__row"
					onclick={() => {
						editing = txn;
						typed = '';
					}}
				>
					<span class="circle" style="--c: {colorVar(style.color)}">
						<Icon name={style.icon} size={18} stroke={2} />
					</span>
					<span class="row__body">
						<span class="row__title">{txn.payee || category(txn)?.name || 'bez kategorie'}</span>
						<span class="row__sub">{sub(txn)}</span>
					</span>
					<span class="row__amount">{formatMoney(txn.amount, { code })}</span>
				</button>

				<div class="actions actions--fill">
					<button
						type="button"
						class="btn btn--primary holds__pill"
						disabled={busy !== null}
						onclick={() => settle(txn, null)}
					>
						Zaúčtováno
					</button>
					<button
						type="button"
						class="btn holds__pill"
						disabled={busy !== null}
						onclick={() => {
							editing = txn;
							typed = '';
						}}
					>
						Jiná částka
					</button>
				</div>
			{/snippet}
		</Deck>
	</section>
{/if}

<Sheet open={editing !== null} title={editing?.payee || 'Blokace'} onclose={() => (editing = null)}>
	{#if editing}
		{@const txn = editing}
		<div class="edit">
			<p class="hint">
				Banka zatím drží {formatMoney(abs(txn.amount), { code })} · {formatDayHeading(txn.date)}.
				Kolik nakonec odešlo? Prázdné pole znamená, že tolik.
			</p>

			<label class="field">
				<span class="field__label">Částka</span>
				<input
					class="field__input"
					inputmode="decimal"
					placeholder={formatMoney(abs(txn.amount), { currency: false })}
					bind:value={typed}
					autocomplete="off"
				/>
			</label>

			<div class="actions actions--fill">
				<button
					type="button"
					class="btn btn--primary"
					disabled={busy !== null}
					onclick={() => settle(txn, amountTyped())}
				>
					Zaúčtovat
				</button>
			</div>
		</div>
	{/if}
</Sheet>

<style>
	.holds__count {
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
	}

	.holds__row {
		min-height: 48px;
	}

	/* The slide's pills are the secondary height: 40, not 48. */
	.holds__pill {
		min-height: 40px;
		font-size: var(--text-md);
	}

	.edit {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
