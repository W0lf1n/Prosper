<script lang="ts">
	/**
	 * Nastavení · Kategorie — one row per bucket with its circle, its type and
	 * a chevron; tapping opens the editor sheet, where the icon and the colour
	 * apply live everywhere the bucket appears (Q54). Categories are archived,
	 * never deleted: old rows have to stay readable.
	 */
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import { createCategory, updateCategory } from '$lib/db/repo';
	import { SPEND_TYPE_LABEL } from '$lib/domain/prosperity';
	import type { Category } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import CategorySheet, { type CategoryInput } from '$lib/ui/CategorySheet.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { categoryStyle, colorVar } from '$lib/ui/palette';
	import { toast } from '$lib/ui/toast.svelte';

	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const visibleCategories = $derived(
		(($categories ?? []) as Category[]).filter((c) => !c.isDeleted)
	);

	let sheetOpen = $state(false);
	let editingId = $state<string | null>(null);
	/* Read back out of the live list, so the sheet sees each patch land. */
	const editing = $derived(
		editingId ? (visibleCategories.find((c) => c.id === editingId) ?? null) : null
	);

	function openCategory(category: Category | null) {
		editingId = category?.id ?? null;
		sheetOpen = true;
	}

	async function addCategory(input: CategoryInput) {
		await createCategory(input);
		sheetOpen = false;
		toast.show(`Kategorie „${input.name}“ přidána`);
	}

	async function patchCategory(
		id: string,
		patch: Partial<CategoryInput> & { isArchived?: boolean }
	) {
		await updateCategory(id, patch);
	}
</script>

<svelte:head>
	<title>Prosper — kategorie</title>
</svelte:head>

<main class="page">
	<AppBar title="Kategorie" back="/nastaveni" />

	<section class="card card--list cats">
		{#each visibleCategories as category (category.id)}
			{@const style = categoryStyle(category)}
			<button
				type="button"
				class="row row--short row--press"
				class:cat--archived={category.isArchived}
				onclick={() => openCategory(category)}
			>
				<span class="circle circle--sm" style="--c: {colorVar(style.color)}">
					<Icon name={style.icon} size={16} stroke={2} />
				</span>
				<span class="row__body">
					<span class="cat__name">{category.name}</span>
				</span>
				<span class="badge">
					{category.isIncome ? 'příjem' : SPEND_TYPE_LABEL[category.spendType]}
				</span>
				{#if category.isArchived}
					<span class="badge">v archivu</span>
				{/if}
				<span class="card__go"><Icon name="chevron-right" size={16} /></span>
			</button>
		{/each}
		<p class="hint cats__hint">
			Ťukni na kategorii a vyber jí ikonu a barvu. Kategorie se archivují, nemažou — staré záznamy
			musí zůstat čitelné.
		</p>
		<div class="cats__foot">
			<button type="button" class="btn" onclick={() => openCategory(null)}>Nová kategorie</button>
		</div>
	</section>
</main>

<CategorySheet
	open={sheetOpen}
	category={editing}
	oncreate={addCategory}
	onpatch={patchCategory}
	onclose={() => (sheetOpen = false)}
/>

<TabBar />

<style>
	.cats {
		padding-top: var(--space-2);
		padding-bottom: var(--space-3);
	}

	.cat__name {
		font-size: var(--text-base);
	}

	.cat--archived {
		opacity: 0.5;
	}

	.cats__hint {
		padding-top: var(--space-3);
	}

	.cats__foot {
		display: flex;
		padding-top: var(--space-3);
	}
</style>
