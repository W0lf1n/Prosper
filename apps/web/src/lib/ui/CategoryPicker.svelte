<script lang="ts">
	/**
	 * The category rail: one pill per bucket, most-used first, each with its
	 * coloured circle. The selected one inverts. A search pill pinned at the
	 * rail's right end — outside the scroll, so it is under the thumb whatever
	 * the rail is showing — opens the whole list (`CategoryPickerSheet`), for
	 * the times when reading forty names is slower than typing four letters,
	 * for the day every bucket of a direction has been archived, and for the
	 * bucket that does not exist yet: the list ends in a row that makes one.
	 */
	import type { Category } from '$lib/domain/types';
	import CategoryPickerSheet from './CategoryPickerSheet.svelte';
	import type { CategoryInput } from './CategorySheet.svelte';
	import Icon from './Icon.svelte';
	import { categoryStyle, colorVar } from './palette';

	interface Props {
		/** Already ranked: most-used first. */
		categories: Category[];
		selectedId: string | null;
		/** The direction a bucket made from the sheet belongs to. */
		isIncome?: boolean;
		onselect: (id: string) => void;
		/** Writes the bucket and selects it. */
		oncreate: (input: CategoryInput) => Promise<void>;
	}

	let { categories, selectedId, isIncome = false, onselect, oncreate }: Props = $props();

	let open = $state(false);
	let rail = $state<HTMLDivElement | null>(null);

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

	/* The list changing — the direction switch, or a bucket just made — sends
	   the rail to the start; then the selection, if there is one, is brought
	   into sight. A bucket made from the sheet is the last pill, and selected. */
	let shown = '';

	$effect(() => {
		const key = categories.map((c) => c.id).join('|');
		const id = selectedId;
		const el = rail;
		if (!el) return;
		if (key !== shown) {
			shown = key;
			el.scrollTo({ left: 0 });
		}
		if (id) reveal(id);
	});
</script>

<div class="buckets">
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
	</div>

	<button
		type="button"
		class="chip chip--more"
		onclick={() => (open = true)}
		aria-label="Všechny kategorie"
	>
		<Icon name="search" size={18} stroke={1.8} />
	</button>
</div>

<CategoryPickerSheet
	{open}
	{categories}
	{selectedId}
	{isIncome}
	{onselect}
	{oncreate}
	onclose={() => (open = false)}
/>

<style>
	/* The rail and, pinned after it, the search pill. The pair bleeds to the
	   screen edge and pays it back as padding, so a pill being scrolled away
	   leaves under the gutter rather than stopping dead at it. */
	.buckets {
		display: flex;
		align-items: center;
		margin: 0 calc(var(--space-4) * -1);
		padding: var(--space-1) var(--space-4) var(--space-2) 0;
	}

	/* The rail's own right gutter is where a pill dissolves under the search
	   pill rather than being cut mid-word against it: the mask fades exactly
	   that gutter, so a rail scrolled to its end still shows its last pill
	   whole. */
	.rail {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: var(--space-2);
		padding: 0 var(--space-4);
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		-webkit-mask-image: linear-gradient(to right, black calc(100% - var(--space-4)), transparent);
		mask-image: linear-gradient(to right, black calc(100% - var(--space-4)), transparent);
	}

	.chip--more {
		width: 40px;
		padding: 0;
		justify-content: center;
		color: var(--ink-2);
	}
</style>
