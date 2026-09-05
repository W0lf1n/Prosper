<script lang="ts">
	/**
	 * Srovnání s bankou — the ledger against a statement.
	 *
	 * `PROJECT-PLAN.md` §1.2 asks for a ledger "reconciled against real bank
	 * balances, no silent gaps", and this is the whole of that mechanism.
	 *
	 * The shape of the screen is the argument: the ledger's figure is shown
	 * **first and unprompted**, then the bank's is typed under it, then the
	 * difference appears as you type. Asking for the bank's number in isolation
	 * and revealing the delta afterwards would make this a quiz. It is not a
	 * quiz — it is two numbers that should agree.
	 *
	 * A difference is offered as a row to write, never as a balance to overwrite.
	 * Overwriting would close the gap and destroy the evidence in one move.
	 */
	import { formatMoney, parseAmount, type Minor } from '$lib/domain/money';
	import { today } from '$lib/domain/datetime';
	import { describeDelta, isClean, reconcileDelta } from '$lib/domain/reconcile';
	import type { Category } from '$lib/domain/types';
	import Money from './Money.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		/** Currency of the account being reconciled (Q49). */
		code?: string;
		open: boolean;
		/** What the ledger says right now. Captured by the caller before opening. */
		computed: Minor;
		accountName: string;
		/** Buckets an adjustment may land in. Income categories included: a
		    difference can be money that arrived as easily as money that left. */
		categories: Category[];
		onsave: (input: {
			statementBalance: Minor;
			date: string;
			adjust: boolean;
			categoryId: string | null;
		}) => Promise<void>;
		onclose: () => void;
	}

	let { open, computed, accountName, categories, code = 'CZK', onsave, onclose }: Props = $props();

	let statementText = $state('');
	let date = $state(today());
	let categoryId = $state('');
	let error = $state('');
	let busy = $state(false);

	$effect(() => {
		if (open) return;
		statementText = '';
		date = today();
		categoryId = '';
		error = '';
		busy = false;
	});

	const parsed = $derived(parseAmount(statementText));
	const statement = $derived(parsed.ok ? parsed.value : null);

	const delta = $derived(statement === null ? null : reconcileDelta({ computed, statement }));

	/**
	 * Default the bucket to OSTATNÍ — the dumping ground the app already watches,
	 * and the honest home for "something happened and I do not know what".
	 */
	const fallback = $derived(
		categories.find((c) => c.name.toUpperCase().startsWith('OSTAT'))?.id ??
			categories.find((c) => !c.isIncome)?.id ??
			''
	);

	/**
	 * Show the default rather than merely applying it.
	 *
	 * The commit falls back on its own, so a blank select still saved to the
	 * right bucket — and told the reader nothing about where their money had
	 * just been filed. A control whose value is invisible is a control nobody
	 * can disagree with.
	 */
	$effect(() => {
		if (!categoryId && fallback) categoryId = fallback;
	});

	async function commit(adjust: boolean) {
		if (statement === null) {
			error = 'Zůstatek z výpisu není číslo.';
			return;
		}
		error = '';
		busy = true;
		try {
			await onsave({
				statementBalance: statement,
				date,
				adjust,
				categoryId: adjust ? categoryId || fallback : null
			});
		} finally {
			busy = false;
		}
	}
</script>

<Sheet {open} title="Srovnat s bankou" {onclose}>
	<div class="form">
		<!-- What this does, before it asks for anything — the sheet is opened a
		     few times a year, and the shape alone does not say what happens on a
		     mismatch. -->
		<p class="lead prose">
			Opíšeš zůstatek z banky a app ho porovná se svým. Když nesedí, nabídne vyrovnávací záznam, aby
			sešit zase seděl — a zůstane vidět, kdy a o kolik se rozešel.
		</p>

		<!--
		  The ledger's figure, first and without being asked for. This is not a
		  memory test — the two numbers are supposed to agree, and hiding one of
		  them until the other is typed would only make it harder to spot a typo.
		-->
		<div class="known">
			<span class="known__label label">{accountName} podle zápisů</span>
			<Money value={computed} size="xl" bold colour={false} {code} />
		</div>

		<label class="field">
			<span class="field__label">Zůstatek z výpisu</span>
			<input
				class="field__input field__input--mono"
				bind:value={statementText}
				inputmode="decimal"
				placeholder="0"
				autocomplete="off"
			/>
		</label>

		<label class="field">
			<span class="field__label">K datu</span>
			<input class="field__input field__input--mono" type="date" bind:value={date} />
		</label>

		{#if delta}
			<div class="delta" data-state={isClean(delta) ? 'clean' : 'off'}>
				{#if isClean(delta)}
					<p class="delta__lead">Sedí to na korunu.</p>
					<p class="delta__note">
						Zapíše se, že jsi to k tomuhle datu zkontroloval. Žádný řádek se nepřidává.
					</p>
				{:else}
					<p class="delta__lead">
						Rozdíl <Money value={delta.amount} size="lg" bold {code} />
					</p>
					<p class="delta__note">{describeDelta(delta)}</p>
				{/if}
			</div>

			{#if !isClean(delta)}
				<label class="field">
					<span class="field__label">Do které kategorie</span>
					<select class="field__input" bind:value={categoryId}>
						{#each categories as category (category.id)}
							<option value={category.id}>{category.name}</option>
						{/each}
					</select>
					<span class="field__hint">
						Vyrovnání je jednorázový řádek — do průměru měsíce se nepočítá.
					</span>
				</label>
			{/if}
		{/if}

		{#if error}
			<p class="error-text">{error}</p>
		{/if}

		{#if delta && !isClean(delta)}
			<button
				type="button"
				class="btn btn--primary btn--block"
				disabled={busy}
				onclick={() => commit(true)}
			>
				Zapsat vyrovnání {formatMoney(delta.amount, { code })}
			</button>
			<!--
			  The honest second option. A difference is often a card payment that
			  has not cleared yet, and writing a row for it would be wrong twice —
			  once now and again when it clears.
			-->
			<button
				type="button"
				class="btn btn--quiet btn--block"
				disabled={busy}
				onclick={() => commit(false)}
			>
				Jen zaznamenat rozdíl
			</button>
		{:else}
			<button
				type="button"
				class="btn btn--primary btn--block"
				disabled={busy || statement === null}
				onclick={() => commit(false)}
			>
				{statement === null ? 'Zadej zůstatek' : 'Hotovo'}
			</button>
		{/if}
	</div>
</Sheet>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.lead {
		font-size: var(--text-sm);
		line-height: var(--leading-base);
		color: var(--ink-3);
	}

	.known {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-3);
	}

	.known__label {
		color: var(--ink-3);
	}

	.delta {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--flag-wash);
	}

	.delta[data-state='clean'] {
		background: var(--in-wash);
	}

	.delta__lead {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.delta__note {
		font-size: var(--text-sm);
		line-height: var(--leading-base);
		color: var(--ink-2);
		text-wrap: pretty;
	}
</style>
