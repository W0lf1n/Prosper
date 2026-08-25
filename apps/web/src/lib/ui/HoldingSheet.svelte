<script lang="ts">
	/**
	 * Adding a holding — a name, what sort of thing it is, and how often it is
	 * worth asking about.
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
	 */
	import { HOLDING_KINDS, KIND_LABEL } from '$lib/domain/holdings';
	import { DAYS, plural } from '$lib/domain/czech';
	import type { Holding } from '$lib/domain/types';
	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		onsave: (input: { name: string; kind: Holding['kind']; reminderDays: number }) => Promise<void>;
		onclose: () => void;
	}

	let { open, onsave, onclose }: Props = $props();

	const CADENCES = [7, 30, 90] as const;

	let name = $state('');
	let kind = $state<Holding['kind']>('investment');
	let reminderDays = $state(30);

	$effect(() => {
		if (open) return;
		name = '';
		kind = 'investment';
		reminderDays = 30;
	});

	const trimmed = $derived(name.trim());

	async function commit() {
		if (!trimmed) return;
		await onsave({ name: trimmed, kind, reminderDays });
	}
</script>

<Sheet {open} title="Nová investice" {onclose}>
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

		<button type="button" class="btn btn--primary btn--block" disabled={!trimmed} onclick={commit}>
			{trimmed ? 'Přidat' : 'Napiš název'}
		</button>
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
		font-weight: 500;
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
</style>
