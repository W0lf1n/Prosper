<script lang="ts">
	/**
	 * Declaring a payment that repeats.
	 *
	 * A form rather than the keypad: this is Settings, not the fast path. It is
	 * opened a handful of times ever, the field that carries the most meaning is
	 * the name, and a sheet with a number pad under a text input has two
	 * keyboards fighting over the bottom of the screen.
	 *
	 * The sign is never asked for. It comes off the category — an income bucket
	 * makes the amount positive, anything else makes it negative — because
	 * "should this be minus" is a question about the app's internals, not about
	 * the salary or the mortgage being described.
	 */
	import { MODE_LABEL } from '$lib/domain/recurring';
	import { formatMoney, parseAmount, neg, abs } from '$lib/domain/money';
	import { monthKey, today } from '$lib/domain/datetime';
	import type { Category, Schedule } from '$lib/domain/types';

	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		/** The schedule being edited, or null to declare a new one. */
		schedule: Schedule | null;
		categories: Category[];
		onsave: (input: {
			payee: string;
			categoryId: string;
			amount: number;
			dayOfMonth: number;
			endMonth: string | null;
			mode: Schedule['mode'];
		}) => Promise<void>;
		onarchive: (() => Promise<void>) | null;
		onclose: () => void;
	}

	let { open, schedule, categories, onsave, onarchive, onclose }: Props = $props();

	let payee = $state('');
	let categoryId = $state('');
	let amountText = $state('');
	let dayOfMonth = $state(15);
	let endMonth = $state('');
	let mode = $state<Schedule['mode']>('confirm');
	let error = $state('');
	let confirmingArchive = $state(false);

	/* Re-seed whenever the sheet opens onto a different row (or onto none). */
	let loaded = $state<string | null | undefined>(undefined);
	$effect(() => {
		if (!open) {
			loaded = undefined;
			return;
		}
		const id = schedule?.id ?? null;
		if (id === loaded) return;
		loaded = id;
		payee = schedule?.payee ?? '';
		categoryId = schedule?.categoryId ?? categories[0]?.id ?? '';
		amountText = schedule ? formatMoney(abs(schedule.amount), { currency: false }) : '';
		dayOfMonth = schedule?.dayOfMonth ?? 15;
		endMonth = schedule?.endMonth ?? '';
		mode = schedule?.mode ?? 'confirm';
		error = '';
		confirmingArchive = false;
	});

	const chosen = $derived(categories.find((c) => c.id === categoryId) ?? null);
	const isIncome = $derived(chosen?.isIncome ?? false);

	/** The year, which is the figure worth showing while the month is being typed. */
	const yearly = $derived.by(() => {
		const parsed = parseAmount(amountText);
		if (!parsed.ok || parsed.value === 0) return null;
		return (abs(parsed.value) * 12) as typeof parsed.value;
	});

	async function commit() {
		const trimmed = payee.trim();
		if (!trimmed) {
			error = 'Napiš, co to je.';
			return;
		}
		if (!categoryId) {
			error = 'Vyber kategorii.';
			return;
		}
		const parsed = parseAmount(amountText);
		if (!parsed.ok || parsed.value === 0) {
			error = 'Částka není číslo.';
			return;
		}
		if (endMonth && endMonth < monthKey(today())) {
			error = 'Konec je v minulosti.';
			return;
		}

		error = '';
		await onsave({
			payee: trimmed,
			categoryId,
			amount: isIncome ? abs(parsed.value) : neg(abs(parsed.value)),
			dayOfMonth,
			endMonth: endMonth || null,
			mode
		});
	}
</script>

<Sheet {open} title={schedule ? schedule.payee : 'Nová pravidelná platba'} {onclose}>
	<div class="form">
		<label class="field">
			<span class="field__label">Co to je</span>
			<input
				class="field__input"
				bind:value={payee}
				placeholder="Netflix, hypotéka, pojištění"
				autocomplete="off"
			/>
		</label>

		<label class="field">
			<span class="field__label">Kategorie</span>
			<select class="field__input" bind:value={categoryId}>
				{#each categories as category (category.id)}
					<option value={category.id}>{category.name}</option>
				{/each}
			</select>
		</label>

		<div class="pair">
			<label class="field">
				<span class="field__label">Částka za měsíc</span>
				<input
					class="field__input field__input--mono"
					bind:value={amountText}
					inputmode="decimal"
					placeholder="0"
				/>
			</label>

			<label class="field">
				<span class="field__label">Den v měsíci</span>
				<input
					class="field__input field__input--mono"
					type="number"
					min="1"
					max="31"
					bind:value={dayOfMonth}
				/>
			</label>
		</div>

		<!--
		  The annual figure, live, while the monthly one is being typed. It is the
		  whole reason this list exists: 379 Kč a month is a rounding error and
		  4 548 Kč a year is a decision, and the moment to see the second number
		  is while the first is still being agreed to.
		-->
		{#if yearly !== null}
			<p class="yearly">
				{isIncome ? 'Přijde' : 'Stojí'}
				<strong>{formatMoney(yearly)}</strong> za rok. 31. se v kratším měsíci posune na jeho poslední
				den.
			</p>
		{/if}

		<fieldset class="group">
			<legend class="field__label">Jak to zapsat</legend>
			<div class="modes">
				{#each ['confirm', 'auto'] as const as option (option)}
					<button
						type="button"
						class="mode"
						class:mode--on={mode === option}
						aria-pressed={mode === option}
						onclick={() => (mode = option)}
					>
						{MODE_LABEL[option]}
					</button>
				{/each}
			</div>
			<p class="field__hint">
				{mode === 'confirm'
					? 'Až přijde den, app ti to nabídne a ty to jedním ťuknutím potvrdíš. Částku můžeš před potvrzením přepsat.'
					: 'Zapíše se samo, jakmile app otevřeš. Pro platby, které se nemění — hypotéka, pojištění.'}
			</p>
		</fieldset>

		<label class="field">
			<span class="field__label">Poslední měsíc <span class="optional">nepovinné</span></span>
			<input class="field__input field__input--mono" type="month" bind:value={endMonth} />
			<span class="field__hint">
				U hypotéky nebo půjčky odsud app spočítá, kolik plateb ještě zbývá.
			</span>
		</label>

		{#if error}
			<p class="error-text">{error}</p>
		{/if}

		<button type="button" class="btn btn--primary btn--block" onclick={commit}>
			{schedule ? 'Uložit' : 'Přidat'}
		</button>

		{#if onarchive}
			{#if confirmingArchive}
				<div class="archive">
					<p class="archive__ask">Zrušit „{schedule?.payee}"? Zapsané platby zůstanou.</p>
					<div class="archive__actions">
						<button type="button" class="btn" onclick={() => (confirmingArchive = false)}>
							Zpět
						</button>
						<button type="button" class="btn btn--danger" onclick={() => void onarchive?.()}>
							Zrušit platbu
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="btn btn--quiet btn--block"
					onclick={() => (confirmingArchive = true)}
				>
					Zrušit pravidelnou platbu
				</button>
			{/if}
		{/if}
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
		/* The amount gets the room; the day never needs more than two digits. */
		grid-template-columns: 1fr 7.5rem;
		gap: var(--space-3);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: none;
	}

	.modes {
		display: flex;
		gap: var(--space-2);
	}

	.mode {
		flex: 1;
		min-height: var(--touch);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--ink-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.mode--on {
		background: color-mix(in srgb, var(--signal) 10%, var(--surface));
		border-color: var(--signal);
		color: var(--ink);
		font-weight: 600;
	}

	@media (hover: hover) {
		.mode:hover {
			border-color: var(--hairline-2);
			color: var(--ink);
		}

		.mode--on:hover {
			border-color: var(--signal);
		}
	}

	.yearly {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-sm);
		line-height: var(--leading-snug);
		color: var(--ink-3);
	}

	.yearly strong {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-md);
		letter-spacing: var(--track-tight);
		color: var(--ink);
	}

	.optional {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink-3);
	}

	.archive {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--hairline));
		border-radius: var(--radius-sm);
		background: var(--danger-wash);
	}

	.archive__ask {
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.archive__actions {
		display: flex;
		gap: var(--space-2);
	}

	.archive__actions .btn {
		flex: 1;
	}
</style>
