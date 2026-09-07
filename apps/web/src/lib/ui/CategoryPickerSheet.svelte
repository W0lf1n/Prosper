<script lang="ts">
	/**
	 * The whole list of buckets, in a sheet: a search field, one row per
	 * category with its circle and its type, and at the end a row that makes
	 * a new one. Zápis opens it from the search pill at the end of the rail,
	 * Výpis from the category field of the edit sheet — the same list both
	 * times, because a bucket is a bucket wherever it is being picked.
	 *
	 * The add row carries whatever was typed: four letters that found nothing
	 * are already the new bucket's name. It opens the editor over this sheet,
	 * and when the editor commits, the parent writes the row and this sheet
	 * hands the new id back as the selection — a bucket made mid-entry is the
	 * bucket the entry goes to. Nothing here touches the database.
	 */
	import { SPEND_TYPE_LABEL } from '$lib/domain/prosperity';
	import { normalize } from '$lib/domain/vocabulary';
	import type { Category } from '$lib/domain/types';
	import CategorySheet, { type CategoryInput } from './CategorySheet.svelte';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import { categoryStyle, colorVar } from './palette';

	interface Props {
		open: boolean;
		/** Already in the order they should be read — most-used first. */
		categories: Category[];
		selectedId: string | null;
		/** The direction a bucket made here belongs to. */
		isIncome?: boolean;
		onselect: (id: string) => void;
		/** Writes the bucket and selects it; the sheet closes once it resolves. */
		oncreate: (input: CategoryInput) => Promise<void>;
		onclose: () => void;
	}

	let {
		open,
		categories,
		selectedId,
		isIncome = false,
		onselect,
		oncreate,
		onclose
	}: Props = $props();

	let query = $state('');
	let creating = $state(false);

	/* A fresh open starts with an empty search. */
	$effect(() => {
		if (!open) query = '';
	});

	const trimmed = $derived(query.trim());

	const results = $derived.by(() => {
		const q = normalize(query);
		if (!q) return categories;
		return categories.filter((c) => normalize(c.name).includes(q));
	});

	/** A name typed that no bucket already has, word for word. */
	const canAdd = $derived(
		trimmed !== '' && !categories.some((c) => normalize(c.name) === normalize(trimmed))
	);

	function choose(id: string) {
		onselect(id);
		onclose();
	}

	async function create(input: CategoryInput) {
		await oncreate(input);
		creating = false;
		onclose();
	}
</script>

<Sheet {open} title="Kategorie" {onclose}>
	<div class="picker">
		<input
			class="field__input"
			type="search"
			bind:value={query}
			placeholder="Hledat kategorii"
			autocomplete="off"
			enterkeyhint="search"
		/>

		<ul class="picker__list">
			{#each results as category (category.id)}
				{@const style = categoryStyle(category)}
				<li>
					<button
						type="button"
						class="row row--short row--press"
						class:picker__item--on={selectedId === category.id}
						aria-pressed={selectedId === category.id}
						onclick={() => choose(category.id)}
					>
						<span class="circle circle--sm" style="--c: {colorVar(style.color)}">
							<Icon name={style.icon} size={16} stroke={2} />
						</span>
						<span class="row__body">
							<span class="picker__name">{category.name}</span>
						</span>
						<span class="badge">{SPEND_TYPE_LABEL[category.spendType]}</span>
					</button>
				</li>
			{/each}
			{#if results.length === 0 && !canAdd}
				<li class="picker__empty hint">Nic takového tu není.</li>
			{/if}
			<li>
				<button
					type="button"
					class="row row--short row--press picker__add"
					onclick={() => (creating = true)}
				>
					<span class="circle circle--sm circle--soft">
						<Icon name="plus" size={16} stroke={2.2} />
					</span>
					<span class="row__body">
						<span class="picker__name">
							{#if canAdd}
								Přidat kategorii „{trimmed}“
							{:else}
								Nová kategorie
							{/if}
						</span>
					</span>
				</button>
			</li>
		</ul>
	</div>
</Sheet>

<CategorySheet
	open={creating}
	category={null}
	draft={{ name: canAdd ? trimmed : '', isIncome }}
	oncreate={create}
	onpatch={() => Promise.resolve()}
	onclose={() => (creating = false)}
/>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.picker__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.picker__name {
		font-size: var(--text-base);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.picker__item--on .picker__name {
		font-weight: 600;
	}

	.picker__add {
		color: var(--ink-2);
	}

	.picker__empty {
		padding: var(--space-4) 0;
	}
</style>
