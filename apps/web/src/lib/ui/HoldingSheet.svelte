<script lang="ts">
	/**
	 * A holding — a name, what sort of thing it is, how often it is worth asking
	 * about, and which bucket feeds it.
	 *
	 * No keypad here, deliberately: the field that matters is the name, and a
	 * sheet that puts a number pad under a text input is a sheet with two
	 * keyboards fighting over the bottom of the screen. The first value is typed
	 * straight afterwards, in the sheet that is built for it.
	 *
	 * The cadence is per holding rather than global (`docs/INVESTMENTS.md` I5): a
	 * pension statement lands quarterly and a wallet can be read in ten seconds,
	 * and one interval for both would nag hardest about the thing that cannot be
	 * answered.
	 *
	 * The bucket and the start date only appear together, because neither means
	 * anything without the other: the bucket says where contributions come from
	 * and the date says from when, and a bucket with no date would open the
	 * holding already funded by everything that ever went through it.
	 */
	import { HOLDING_KINDS, KIND_LABEL } from '$lib/domain/holdings';
	import { DAYS, plural } from '$lib/domain/czech';
	import { startOfMonth, today } from '$lib/domain/datetime';
	import type { Category, Holding } from '$lib/domain/types';
	import Sheet from './Sheet.svelte';

	export interface HoldingInput {
		name: string;
		kind: Holding['kind'];
		reminderDays: number;
		categoryId: string | null;
		startDate: string;
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

	const CADENCES = [7, 30, 90] as const;
	const NONE = '';

	let name = $state('');
	let kind = $state<Holding['kind']>('investment');
	let reminderDays = $state(30);
	let categoryId = $state<string>(NONE);
	let startDate = $state(startOfMonth(today()));
	let confirmingArchive = $state(false);

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
		kind = holding?.kind ?? 'investment';
		reminderDays = holding?.reminderDays ?? 30;
		categoryId = holding?.categoryId ?? NONE;
		startDate = holding?.startDate ?? startOfMonth(today());
		confirmingArchive = false;
	});

	const trimmed = $derived(name.trim());

	async function commit() {
		if (!trimmed) return;
		await onsave({
			name: trimmed,
			kind,
			reminderDays,
			categoryId: categoryId || null,
			startDate
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
				placeholder="Penzijko, ETF, spořicí účet"
				autocomplete="off"
				enterkeyhint="done"
			/>
		</label>

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
				{#each CADENCES as option (option)}
					<button
						type="button"
						class="option option--plain"
						class:option--on={reminderDays === option}
						aria-pressed={reminderDays === option}
						onclick={() => (reminderDays = option)}
					>
						{option}
						{plural(option, DAYS)}
					</button>
				{/each}
			</div>
			<p class="field__hint">
				Po téhle době ti app řekne, že hodnota je stará. Dá se změnit kdykoliv.
			</p>
		</fieldset>

		{#if categories.length > 0}
			<label class="field">
				<span class="field__label">Kam na to posíláš <span class="optional">nepovinné</span></span>
				<select class="field__input" bind:value={categoryId}>
					<option value={NONE}>— nepřiřazeno —</option>
					{#each categories as category (category.id)}
						<option value={category.id}>{category.name}</option>
					{/each}
				</select>
				<span class="field__hint">
					{categoryId
						? 'App z výpisu spočítá, kolik jsi sem vložil, a kolik z hodnoty je růst.'
						: 'Bez kategorie app neukáže, kolik jsi vložil — jen aktuální hodnotu.'}
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

		<button type="button" class="btn btn--primary btn--block" disabled={!trimmed} onclick={commit}>
			{trimmed ? (holding ? 'Uložit' : 'Přidat') : 'Napiš název'}
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

	/* Sized to their own words rather than to a share of the row: four kinds and
	   three cadences do not divide into the same grid, and forcing them to would
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
