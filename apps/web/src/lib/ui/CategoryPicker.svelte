<script lang="ts">
	/**
	 * The category rail: one pill per bucket, most-used first, each with its
	 * coloured circle. The selected one inverts. A search pill at the end opens
	 * the whole list, for the times when reading forty names is slower than
	 * typing four letters — and for the day every bucket of a direction has
	 * been archived, when the sheet is the only way to a first one.
	 */
	import { resolve } from '$app/paths';
	import { normalize } from '$lib/domain/vocabulary';
	import type { Category } from '$lib/domain/types';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import { categoryStyle, colorVar } from './palette';

	interface Props {
		/** Already ranked: most-used first. */
		categories: Category[];
		selectedId: string | null;
		onselect: (id: string) => void;
	}

	let { categories, selectedId, onselect }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let rail = $state<HTMLDivElement | null>(null);

	const results = $derived.by(() => {
		const q = normalize(query);
		if (!q) return categories;
		return categories.filter((c) => normalize(c.name).includes(q));
	});

	const TYPE_LABEL: Record<Category['spendType'], string> = {
		need: 'nutné',
		want: 'chtěné',
		give: 'dávání',
		save: 'spoření',
		debt: 'dluh'
	};

	function choose(id: string) {
		onselect(id);
		open = false;
		query = '';
	}

	/**
	 * Keep the chosen bucket on screen. Scrolled by hand rather than by
	 * `scrollIntoView`, which is free to scroll the page as well.
	 */
	function reveal(id: string) {
		const el = rail;
		const chip = el?.querySelector<HTMLElement>(`[data-category="${CSS.escape(id)}"]`);
		if (!el || !chip) return;
		const left = chip.offsetLeft;
		const right = left + chip.offsetWidth;
		const margin = 16;
		if (left - margin < el.scrollLeft) {
			el.scrollTo({ left: Math.max(0, left - margin), behavior: 'smooth' });
		} else if (right + margin > el.scrollLeft + el.clientWidth) {
			el.scrollTo({ left: right + margin - el.clientWidth, behavior: 'smooth' });
		}
	}

	/* The list changing — the direction switch — sends the rail to the start;
	   a selection only scrolls if the pill is out of sight. */
	let shown = '';

	$effect(() => {
		const key = categories.map((c) => c.id).join('|');
		const id = selectedId;
		const el = rail;
		if (!el) return;
		if (key !== shown) {
			shown = key;
			el.scrollTo({ left: 0 });
		} else if (id) {
			reveal(id);
		}
	});
</script>

<div class="rail" bind:this={rail}>
	{#each categories as category (category.id)}
		{@const style = categoryStyle(category)}
		<button
			type="button"
			class="chip"
			class:chip--on={selectedId === category.id}
			data-category={category.id}
			aria-pressed={selectedId === category.id}
			onclick={() => onselect(category.id)}
		>
			<span class="circle circle--xs" style="--c: {colorVar(style.color)}">
				<Icon name={style.icon} size={14} stroke={2} />
			</span>
			{category.name}
		</button>
	{/each}

	<button
		type="button"
		class="chip chip--more"
		onclick={() => (open = true)}
		aria-label="Všechny kategorie"
	>
		<Icon name="search" size={18} stroke={1.8} />
	</button>
</div>

<Sheet {open} title="Kategorie" onclose={() => (open = false)}>
	<div class="picker">
		<input
			class="field__input"
			type="search"
			bind:value={query}
			placeholder="Hledat kategorii"
			autocomplete="off"
		/>

		<ul class="picker__list">
			{#each results as category (category.id)}
				{@const style = categoryStyle(category)}
				<li>
					<button
						type="button"
						class="row row--short row--press"
						class:picker__item--on={selectedId === category.id}
						onclick={() => choose(category.id)}
					>
						<span class="circle circle--sm" style="--c: {colorVar(style.color)}">
							<Icon name={style.icon} size={16} stroke={2} />
						</span>
						<span class="row__body">
							<span class="picker__name">{category.name}</span>
						</span>
						<span class="badge">{TYPE_LABEL[category.spendType]}</span>
					</button>
				</li>
			{/each}
			{#if results.length === 0}
				{#if categories.length === 0}
					<li class="picker__empty hint">
						Žádná kategorie. <a class="link" href={resolve('/nastaveni')}
							>Založ první v Nastavení.</a
						>
					</li>
				{:else}
					<li class="picker__empty hint">Nic takového tu není.</li>
				{/if}
			{/if}
		</ul>
	</div>
</Sheet>

<style>
	/* Bleeds to the screen edge and pays it back as padding, so a pill being
	   scrolled away leaves under the gutter rather than stopping dead at it. */
	.rail {
		display: flex;
		gap: var(--space-2);
		margin: 0 calc(var(--space-4) * -1);
		padding: var(--space-1) var(--space-4) var(--space-2);
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
	}

	.chip {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 40px;
		padding: 0 14px 0 6px;
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.2px;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.chip:active {
		background: var(--surface-2);
	}

	.chip--on,
	.chip--on:active {
		background: var(--pill);
		color: var(--pill-ink);
	}

	.chip--more {
		width: 40px;
		padding: 0;
		justify-content: center;
		color: var(--ink-2);
	}

	/* ── the sheet ───────────────────────────────────────────────────────── */

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

	.picker__empty {
		padding: var(--space-4) 0;
	}
</style>
