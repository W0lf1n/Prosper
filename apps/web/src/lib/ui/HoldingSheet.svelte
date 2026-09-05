<script lang="ts">
	/**
	 * A holding — a name, what it is worth today, what sort of thing it is, how
	 * often it is worth asking about, and which bucket feeds it.
	 *
	 * The value is asked here, on the first sheet, for a new holding. It was not
	 * until 2026-09-05: the sheet took the name and the cadence and handed over
	 * to the keypad for the number, and the number was the whole reason the
	 * sheet had been opened. A sheet about an investment with nowhere to type
	 * what it is worth reads as an app that cannot record it. So the amount is
	 * a plain decimal field under the name — the phone keyboard, like the
	 * opening balance in Settings — and no second keyboard fights it. Left
	 * blank, the keypad still follows, so a holding whose statement is not to
	 * hand is not refused.
	 *
	 * Editing an existing holding never shows the field: a value has its own
	 * sheet with the previous reading and the delta beside it, and a number
	 * changed in passing while fixing a typo is exactly the reading nobody
	 * meant to write.
	 *
	 * The cadence is per holding rather than global (`docs/INVESTMENTS.md` I5): a
	 * pension statement lands quarterly and a wallet can be read in ten seconds,
	 * and one interval for both would nag hardest about the thing that cannot be
	 * answered. Three presets, and any other number of days typed.
	 *
	 * The bucket and the start date only appear together, because neither means
	 * anything without the other: the bucket says where contributions come from
	 * and the date says from when, and a bucket with no date would open the
	 * holding already funded by everything that ever went through it.
	 */
	import {
		DEFAULT_REMINDER_DAYS,
		HOLDING_KINDS,
		KIND_LABEL,
		MAX_REMINDER_DAYS,
		REMINDER_PRESETS,
		isValidReminderDays
	} from '$lib/domain/holdings';
	import { DAYS, plural } from '$lib/domain/czech';
	import { startOfMonth, today } from '$lib/domain/datetime';
	import { currencySymbol, parseAmount, type Minor } from '$lib/domain/money';
	import type { Category, Holding } from '$lib/domain/types';
	import Sheet from './Sheet.svelte';

	export interface HoldingInput {
		name: string;
		kind: Holding['kind'];
		reminderDays: number;
		categoryId: string | null;
		startDate: string;
		/**
		 * The first reading, typed in the same breath as the name. Only asked
		 * for a new holding; null when left blank, and then the keypad follows.
		 */
		value: Minor | null;
	}

	interface Props {
		open: boolean;
		/** The holding being edited, or null to add a new one. */
		holding?: Holding | null;
		/** Buckets that may fund a holding. Income categories are not offered. */
		categories?: Category[];
		onsave: (input: HoldingInput) => Promise<void>;
		onarchive?: (() => Promise<void>) | null;
		onclose: () => void;
	}

	let {
		open,
		holding = null,
		categories = [],
		onsave,
		onarchive = null,
		onclose
	}: Props = $props();

	const NONE = '';

	const isPreset = (days: number) => (REMINDER_PRESETS as readonly number[]).includes(days);

	let name = $state('');
	let valueText = $state('');
	let kind = $state<Holding['kind']>('investment');
	let reminderDays = $state<number>(DEFAULT_REMINDER_DAYS);
	/** The fourth chip: a number of days the presets do not cover. */
	let customCadence = $state(false);
	let customDays = $state('');
	let categoryId = $state<string>(NONE);
	let startDate = $state(startOfMonth(today()));
	let confirmingArchive = $state(false);
	let error = $state('');

	/* Re-seed whenever the sheet opens onto a different row (or onto none). */
	let loaded = $state<string | null | undefined>(undefined);
	$effect(() => {
		if (!open) {
			loaded = undefined;
			return;
		}
		const id = holding?.id ?? null;
		if (id === loaded) return;
		loaded = id;
		name = holding?.name ?? '';
		valueText = '';
		kind = holding?.kind ?? 'investment';
		const cadence = holding?.reminderDays ?? DEFAULT_REMINDER_DAYS;
		reminderDays = cadence;
		customCadence = !isPreset(cadence);
		customDays = customCadence ? String(cadence) : '';
		categoryId = holding?.categoryId ?? NONE;
		startDate = holding?.startDate ?? startOfMonth(today());
		confirmingArchive = false;
		error = '';
	});

	const trimmed = $derived(name.trim());
	const hasValue = $derived(valueText.trim() !== '');

	function choosePreset(days: number) {
		customCadence = false;
		reminderDays = days;
	}

	function chooseCustom() {
		customCadence = true;
		error = '';
	}

	/** What the button says: the one missing thing, or what pressing it does. */
	const action = $derived(
		!trimmed ? 'Napiš název' : holding ? 'Uložit' : hasValue ? 'Přidat' : 'Přidat a zapsat hodnotu'
	);

	async function commit() {
		if (!trimmed) return;

		const days = customCadence ? Number(customDays.trim()) : reminderDays;
		if (!isValidReminderDays(days)) {
			error = `Počet dní musí být celé číslo od 1 do ${MAX_REMINDER_DAYS}.`;
			return;
		}

		let value: Minor | null = null;
		if (!holding && hasValue) {
			const parsed = parseAmount(valueText);
			if (!parsed.ok || parsed.value < 0) {
				error = 'Hodnota není částka.';
				return;
			}
			value = parsed.value;
		}

		error = '';
		await onsave({
			name: trimmed,
			kind,
			reminderDays: days,
			categoryId: categoryId || null,
			startDate,
			value
		});
	}
</script>

<Sheet {open} title={holding ? holding.name : 'Nová investice'} {onclose}>
	<div class="form">
		<label class="field">
			<span class="field__label">Název</span>
			<input
				class="field__input"
				bind:value={name}
				placeholder="Investiční účet, penzijko, ETF"
				autocomplete="off"
				enterkeyhint="next"
			/>
		</label>

		{#if !holding}
			<label class="field">
				<span class="field__label">Hodnota teď</span>
				<span class="amount">
					<input
						class="field__input field__input--mono"
						bind:value={valueText}
						inputmode="decimal"
						placeholder="100 000"
						autocomplete="off"
						enterkeyhint="done"
					/>
					<span class="amount__unit">{currencySymbol()}</span>
				</span>
				<span class="field__hint">
					Kolik to má dneska hodnotu — opiš z výpisu. Když ji zatím neznáš, nech prázdné a zapíšeš
					ji hned potom na klávesnici.
				</span>
			</label>
		{/if}

		<fieldset class="group">
			<legend class="field__label">Co to je</legend>
			<div class="options">
				{#each HOLDING_KINDS as option (option)}
					<button
						type="button"
						class="option"
						class:option--on={kind === option}
						aria-pressed={kind === option}
						onclick={() => (kind = option)}
					>
						<span class="dot" data-kind={option}></span>
						{KIND_LABEL[option]}
					</button>
				{/each}
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="field__label">Připomenout po</legend>
			<div class="options">
				{#each REMINDER_PRESETS as option (option)}
					<button
						type="button"
						class="option option--plain"
						class:option--on={!customCadence && reminderDays === option}
						aria-pressed={!customCadence && reminderDays === option}
						onclick={() => choosePreset(option)}
					>
						{option}
						{plural(option, DAYS)}
					</button>
				{/each}
				<button
					type="button"
					class="option"
					class:option--on={customCadence}
					aria-pressed={customCadence}
					onclick={chooseCustom}
				>
					jinak
				</button>
			</div>

			{#if customCadence}
				<label class="field">
					<span class="field__label">Po kolika dnech</span>
					<span class="amount">
						<input
							class="field__input field__input--mono"
							bind:value={customDays}
							inputmode="numeric"
							placeholder="60"
							autocomplete="off"
							enterkeyhint="done"
						/>
						<span class="amount__unit">dní</span>
					</span>
				</label>
			{/if}

			<p class="field__hint">
				Po téhle době ti app na téhle obrazovce a v Měsíci připomene, že je čas hodnotu přepsat. Dá
				se změnit kdykoliv.
			</p>
		</fieldset>

		{#if categories.length > 0}
			<label class="field">
				<span class="field__label">Kam na to posíláš <span class="optional">nepovinné</span></span>
				<select class="field__input" bind:value={categoryId}>
					<option value={NONE}>— nic tam neposílám —</option>
					{#each categories as category (category.id)}
						<option value={category.id}>{category.name}</option>
					{/each}
				</select>
				<span class="field__hint">
					{categoryId
						? 'App z výpisu spočítá, kolik jsi sem vložil, a kolik z hodnoty je růst.'
						: 'Bez kategorie app ukáže jen aktuální hodnotu — pro účet, kam nic neposíláš, je to přesně ono.'}
				</span>
			</label>

			{#if categoryId}
				<label class="field">
					<span class="field__label">Počítat vklady od</span>
					<input class="field__input field__input--mono" type="date" bind:value={startDate} />
					<span class="field__hint">
						Výdaje do téhle kategorie před tímhle datem se nepočítají. Jinak by nová investice
						začínala „zaplacená“ vším, co tou kategorií kdy prošlo.
					</span>
				</label>
			{/if}
		{/if}

		{#if error}
			<p class="error-text" role="alert">{error}</p>
		{/if}

		<button type="button" class="btn btn--primary btn--block" disabled={!trimmed} onclick={commit}>
			{action}
		</button>

		{#if onarchive}
			{#if confirmingArchive}
				<div class="archive">
					<p class="archive__ask">Schovat „{holding?.name}“? Zápisy zůstanou.</p>
					<div class="archive__actions">
						<button type="button" class="btn" onclick={() => (confirmingArchive = false)}>
							Zpět
						</button>
						<button type="button" class="btn btn--danger" onclick={() => void onarchive?.()}>
							Schovat
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="btn btn--quiet btn--block"
					onclick={() => (confirmingArchive = true)}
				>
					Schovat investici
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

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: none;
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* The number and its unit on one line: the unit is context, not a control,
	   so it sits outside the field in the same colour as a hint. */
	.amount {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.amount .field__input {
		flex: 1;
		min-width: 0;
	}

	.amount__unit {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-md);
		color: var(--ink-3);
	}

	/* Sized to their own words rather than to a share of the row: four kinds and
	   four cadences do not divide into the same grid, and forcing them to would
	   set "hotovost" and "spoření" at two different widths for no reason. */
	.option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
		padding-inline: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-full);
		background: var(--surface-2);
		font-size: var(--text-md);
		font-weight: 400;
		color: var(--ink-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.option--plain {
		font-variant-numeric: tabular-nums;
	}

	.option--on {
		background: color-mix(in srgb, var(--signal) 10%, var(--surface));
		border-color: var(--signal);
		color: var(--ink);
		font-weight: 600;
	}

	@media (hover: hover) {
		.option:hover {
			border-color: var(--hairline-2);
			color: var(--ink);
		}

		.option--on:hover {
			border-color: var(--signal);
		}
	}

	/* The same five-colour language the spend-type dots speak on the entry
	   screen — a class is legible before its name is read. */
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--split-live);
	}

	.dot[data-kind='investment'] {
		background: var(--split-give);
	}

	.dot[data-kind='savings'] {
		background: var(--in);
	}

	.dot[data-kind='crypto'] {
		background: var(--flag);
	}

	.optional {
		margin-inline-start: var(--space-2);
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--ink-3);
	}

	.archive {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--danger-edge);
		border-radius: var(--radius-md);
		background: var(--danger-wash);
	}

	.archive__ask {
		font-size: var(--text-md);
		line-height: var(--leading-snug);
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
