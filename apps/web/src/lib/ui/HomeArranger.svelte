<script lang="ts">
	/**
	 * Which cards Domů shows, and in what order (`domain/dashboard.ts`) —
	 * the body of Nastavení › Domů (Q95; it was a sheet on Domů itself for
	 * the prototype, Q92).
	 *
	 * Every change lands as it is tapped; there is nothing to save. Arrows
	 * rather than dragging: an arrow is a target the thumb can hit on a
	 * moving bus, and a drag fights the page's own scroll.
	 */
	import { flip } from 'svelte/animate';
	import {
		WIDGETS,
		hiddenWidgets,
		hideWidget,
		moveWidget,
		showWidget,
		type HomeLayout,
		type WidgetId
	} from '$lib/domain/dashboard';
	import Icon from './Icon.svelte';

	interface Props {
		layout: HomeLayout;
		onchange: (layout: HomeLayout) => void;
	}

	let { layout, onchange }: Props = $props();

	const hidden = $derived(hiddenWidgets(layout));

	function move(id: WidgetId, by: -1 | 1) {
		onchange(moveWidget(layout, id, by));
	}
</script>

<div class="editor">
	<section class="card card--list editor__group">
		<h3 class="label">Na Domů</h3>
		{#if layout.widgets.length === 0}
			<p class="hint">Nic — jen zůstatek měsíce. Přidej kartu níž.</p>
		{/if}
		{#each layout.widgets as id, index (id)}
			<div class="editor__row" animate:flip={{ duration: 180 }}>
				<span class="row__body">
					<span class="row__title">{WIDGETS[id].title}</span>
					<span class="row__sub">{WIDGETS[id].note}</span>
				</span>
				<button
					type="button"
					class="btn editor__move"
					aria-label="{WIDGETS[id].title} výš"
					disabled={index === 0}
					onclick={() => move(id, -1)}
				>
					<Icon name="arrow-up" size={18} stroke={2} />
				</button>
				<button
					type="button"
					class="btn editor__move"
					aria-label="{WIDGETS[id].title} níž"
					disabled={index === layout.widgets.length - 1}
					onclick={() => move(id, 1)}
				>
					<Icon name="arrow-down" size={18} stroke={2} />
				</button>
				<button
					type="button"
					class="btn btn--quiet editor__toggle"
					onclick={() => onchange(hideWidget(layout, id))}
				>
					Skrýt
				</button>
			</div>
		{/each}
	</section>

	{#if hidden.length > 0}
		<section class="card card--list editor__group">
			<h3 class="label">Přidat</h3>
			{#each hidden as id (id)}
				<div class="editor__row" animate:flip={{ duration: 180 }}>
					<span class="row__body">
						<span class="row__title">{WIDGETS[id].title}</span>
						<span class="row__sub">{WIDGETS[id].note}</span>
					</span>
					<button
						type="button"
						class="btn editor__toggle"
						onclick={() => onchange(showWidget(layout, id))}
					>
						<Icon name="plus" size={16} stroke={2} />
						Přidat
					</button>
				</div>
			{/each}
		</section>
	{/if}
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.editor__group .label {
		padding: var(--space-3) 0 var(--space-1);
	}

	.editor__row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 60px;
		padding: var(--space-2) 0;
	}

	/* The note is what the card is for — it wraps rather than being cut. */
	.editor__row .row__sub {
		white-space: normal;
	}

	.editor__row + .editor__row {
		border-top: 1px solid var(--hairline);
	}

	/* Round, the size of a fingertip: the arrows are what this sheet is for. */
	.editor__move {
		width: 40px;
		padding: 0;
	}

	.editor__toggle {
		flex: none;
	}
</style>
