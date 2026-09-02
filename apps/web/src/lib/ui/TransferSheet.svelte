<script lang="ts">
	/**
	 * Moving money between two accounts — Q49, and since 2026-09-02 an exchange.
	 *
	 * Two rows, never one (§6.1): what leaves one account and what lands on the
	 * other. Inside one currency that is a single amount asked once; across
	 * currencies both sides are asked, because the pair *is* the exchange rate
	 * — 2 470 Kč out, 100 € in — and no rate is ever fetched or stored.
	 *
	 * With one account per currency (Q50) every transfer crosses a currency, so
	 * the two legs count the way they read: what leaves is an expense from a
	 * bucket chosen here, what arrives is income in SMĚNA. The koruna month
	 * shows the holiday it paid for; the euro month shows what arrived.
	 *
	 * A form, not the keypad: a transfer is a rare, deliberate act and has no
	 * claim on the five-second path. That is why it lives on /tape and in
	 * Settings and nowhere near the entry screen.
	 */
	import { lastExchangeCategoryId, liveAccounts, validateTransfer } from '$lib/domain/accounts';
	import { categoryRanking } from '$lib/domain/ledger';
	import { currencySymbol, parseAmount, type Minor } from '$lib/domain/money';
	import { today } from '$lib/domain/datetime';
	import type { Account, Category, Txn } from '$lib/domain/types';

	import Sheet from './Sheet.svelte';

	export interface TransferInput {
		fromAccountId: string;
		toAccountId: string;
		amountOut: Minor;
		amountIn: Minor;
		/** The bucket the outgoing leg is spent from. */
		categoryId: string;
		date: string;
	}

	interface Props {
		open: boolean;
		accounts: Account[];
		/** Every category; the sheet keeps the live spending ones. */
		categories: Category[];
		/** Past transfer legs, so the bucket opens on the last one used and the
		    rest rank by habit. Any rows will do — the legs are picked out. */
		exchanges: Txn[];
		/** Which account the "from" select opens on — the screen's own. */
		defaultFromId: string | null;
		onsave: (input: TransferInput) => Promise<void>;
		onclose: () => void;
	}

	let { open, accounts, categories, exchanges, defaultFromId, onsave, onclose }: Props = $props();

	const live = $derived(liveAccounts(accounts));

	/** Spending buckets, most-used-for-exchanges first — the keypad's own
	    ranking, run over the outgoing legs alone. */
	const buckets = $derived.by(() => {
		const spending = categories.filter((c) => !c.isDeleted && !c.isArchived && !c.isIncome);
		const byId = new Map(spending.map((c) => [c.id, c]));
		const legs = exchanges.filter((t) => !t.isDeleted && t.transferPairId !== null && t.amount < 0);
		return categoryRanking(legs, [...byId.keys()])
			.map((id) => byId.get(id)!)
			.filter(Boolean);
	});

	let fromId = $state('');
	let toId = $state('');
	let categoryId = $state('');
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
		categoryId = lastExchangeCategoryId(exchanges) ?? buckets[0]?.id ?? '';
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
			amountIn: amountIn ?? 0,
			categoryId: categoryId || null
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
		if (problems.includes('category')) {
			error = 'Do jaké kategorie ten výdaj patří? Vyber ji.';
			return;
		}

		error = '';
		await onsave({
			fromAccountId: from.id,
			toAccountId: to.id,
			amountOut: amountOut!,
			amountIn: amountIn!,
			categoryId,
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

		<!-- The koruny leave as an expense, and an expense has a bucket — the
		     holiday's, the mortgage's. It is asked the way every expense is
		     asked, by its bucket, not "from" one: nothing leaves a category. A
		     select rather than the keypad's chip rail: the rail opens a sheet
		     of its own for search, and a sheet inside a sheet is one modal too
		     many. -->
		<label class="field">
			<span class="field__label">Kategorie výdaje</span>
			<select class="field__input" bind:value={categoryId}>
				{#if !categoryId}
					<option value="">za co to je…</option>
				{/if}
				{#each buckets as bucket (bucket.id)}
					<option value={bucket.id}>{bucket.name}</option>
				{/each}
			</select>
			<span class="field__hint">
				Odchozí částka je výdaj jako každý jiný — dovolená, lifestyle, hypotéka.
			</span>
		</label>

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
		{/if}

		<p class="field__hint">
			Co odejde, se zapíše jako výdaj ve zvolené kategorii; co dorazí, jako příjem ve SMĚNA. Každý
			účet to vidí ve své měně a dohromady se nesčítají.
		</p>

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
