<script lang="ts">
	/**
	 * Moving money between two accounts — Q49.
	 *
	 * Two rows, never one (§6.1): what leaves one account and what lands on the
	 * other. Inside one currency that is a single amount asked once; across
	 * currencies both sides are asked, because the pair *is* the exchange rate
	 * — 2 470 Kč out, 100 € in — and no rate is ever fetched or stored.
	 *
	 * A form, not the keypad: a transfer is a rare, deliberate act and has no
	 * claim on the five-second path. That is why it lives on /tape and in
	 * Settings and nowhere near the entry screen.
	 */
	import { liveAccounts, validateTransfer } from '$lib/domain/accounts';
	import { currencySymbol, parseAmount, type Minor } from '$lib/domain/money';
	import { today } from '$lib/domain/datetime';
	import type { Account } from '$lib/domain/types';

	import Sheet from './Sheet.svelte';

	export interface TransferInput {
		fromAccountId: string;
		toAccountId: string;
		amountOut: Minor;
		amountIn: Minor;
		date: string;
	}

	interface Props {
		open: boolean;
		accounts: Account[];
		/** Which account the "from" select opens on — the screen's own. */
		defaultFromId: string | null;
		onsave: (input: TransferInput) => Promise<void>;
		onclose: () => void;
	}

	let { open, accounts, defaultFromId, onsave, onclose }: Props = $props();

	const live = $derived(liveAccounts(accounts));

	let fromId = $state('');
	let toId = $state('');
	let outText = $state('');
	let inText = $state('');
	let date = $state(today());
	let error = $state('');

	/* Re-seed each time the sheet opens. */
	let seeded = $state(false);
	$effect(() => {
		if (!open) {
			seeded = false;
			return;
		}
		if (seeded) return;
		seeded = true;
		fromId = defaultFromId ?? live[0]?.id ?? '';
		toId = live.find((a) => a.id !== fromId)?.id ?? '';
		outText = '';
		inText = '';
		date = today();
		error = '';
	});

	const from = $derived(live.find((a) => a.id === fromId) ?? null);
	const to = $derived(live.find((a) => a.id === toId) ?? null);
	/** One amount inside a currency; both sides across two. */
	const crossCurrency = $derived(from !== null && to !== null && from.currency !== to.currency);

	function parsed(text: string): Minor | null {
		const result = parseAmount(text);
		return result.ok && result.value > 0 ? result.value : null;
	}

	async function commit() {
		if (!from || !to) return;
		const amountOut = parsed(outText);
		const amountIn = crossCurrency ? parsed(inText) : amountOut;

		const problems = validateTransfer({
			from,
			to,
			amountOut: amountOut ?? 0,
			amountIn: amountIn ?? 0
		});
		if (problems.includes('same-account')) {
			error = 'Vyber dva různé účty.';
			return;
		}
		if (problems.includes('amount-out')) {
			error = 'Kolik odchází? Částka není číslo.';
			return;
		}
		if (problems.includes('amount-in')) {
			error = 'Kolik dorazí? Částka není číslo.';
			return;
		}

		error = '';
		await onsave({
			fromAccountId: from.id,
			toAccountId: to.id,
			amountOut: amountOut!,
			amountIn: amountIn!,
			date
		});
	}
</script>

<Sheet {open} title="Převod mezi účty" {onclose}>
	<div class="form">
		<div class="pair">
			<label class="field">
				<span class="field__label">Z účtu</span>
				<select class="field__input" bind:value={fromId}>
					{#each live as account (account.id)}
						<option value={account.id}>{account.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span class="field__label">Na účet</span>
				<select class="field__input" bind:value={toId}>
					{#each live as account (account.id)}
						<option value={account.id}>{account.name}</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="pair">
			<label class="field">
				<span class="field__label">
					{crossCurrency ? 'Odejde' : 'Částka'}
					{#if from}<span class="unit">{currencySymbol(from.currency)}</span>{/if}
				</span>
				<input
					class="field__input field__input--mono"
					bind:value={outText}
					inputmode="decimal"
					placeholder="0"
				/>
			</label>

			{#if crossCurrency}
				<label class="field">
					<span class="field__label">
						Dorazí
						{#if to}<span class="unit">{currencySymbol(to.currency)}</span>{/if}
					</span>
					<input
						class="field__input field__input--mono"
						bind:value={inText}
						inputmode="decimal"
						placeholder="0"
					/>
				</label>
			{:else}
				<label class="field">
					<span class="field__label">Kdy</span>
					<input class="field__input field__input--mono" type="date" bind:value={date} />
				</label>
			{/if}
		</div>

		{#if crossCurrency}
			<label class="field">
				<span class="field__label">Kdy</span>
				<input class="field__input field__input--mono" type="date" bind:value={date} />
			</label>
			<p class="field__hint">
				Obě částky zadáváš ty — kurz je v nich, app žádný nestahuje ani si ho nepamatuje.
			</p>
		{:else}
			<p class="field__hint">
				Převod není výdaj ani příjem — v přehledech měsíce se neukáže, jen pohne zůstatky.
			</p>
		{/if}

		{#if error}
			<p class="error-text">{error}</p>
		{/if}

		<button type="button" class="btn btn--primary btn--block" onclick={commit}>Převést</button>
	</div>
</Sheet>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 360px) {
		.pair {
			grid-template-columns: 1fr;
		}
	}

	.unit {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink-3);
	}
</style>
