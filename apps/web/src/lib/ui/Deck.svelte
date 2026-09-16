<script lang="ts" generics="T">
	/**
	 * A deck of slides swiped sideways — K potvrzení and Blokace on Domů
	 * (Q71, Q75). One slide per item, native scroll-snap, each slide a well
	 * inside the card and one step narrower than it so the next one shows its
	 * edge; a row of dots under the deck says where you are and takes a tap.
	 * With one item there is nothing to swipe to: the slide takes the whole
	 * width and the dots stay away.
	 *
	 * The card around it is the caller's — the label, the counter in the head
	 * (`position` is bindable for it), and whatever pill sits under the dots.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		items: T[];
		key: (item: T) => string;
		/** What a slide is called, for assistive technology and the dots. */
		title: (item: T) => string;
		/** The dots' own name: "Platby k potvrzení". */
		label: string;
		/** Which slide is under the thumb; bind it to show `1 z 3`. */
		position?: number;
		slide: Snippet<[T]>;
	}

	let { items, key, title, label, position = $bindable(0), slide }: Props = $props();

	// Native scroll-snap does the swiping; this only keeps track of which slide
	// is nearest the left edge. A slide that leaves the list (confirmed,
	// settled) makes the browser re-snap to a neighbour, so the position is
	// clamped rather than kept.
	let deck = $state<HTMLDivElement | null>(null);
	let index = $state(0);
	const shown = $derived(Math.min(index, Math.max(0, items.length - 1)));
	$effect(() => {
		if (position !== shown) position = shown;
	});

	function slides(): HTMLElement[] {
		return deck ? (Array.from(deck.children) as HTMLElement[]) : [];
	}

	function onScroll() {
		if (!deck) return;
		const all = slides();
		const origin = all[0]?.offsetLeft ?? 0;
		let nearest = 0;
		let distance = Infinity;
		all.forEach((el, i) => {
			const d = Math.abs(el.offsetLeft - origin - deck!.scrollLeft);
			if (d < distance) {
				distance = d;
				nearest = i;
			}
		});
		index = nearest;
	}

	function goTo(i: number) {
		if (!deck) return;
		const all = slides();
		const el = all[i];
		if (!el) return;
		const origin = all[0]?.offsetLeft ?? 0;
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		deck.scrollTo({ left: el.offsetLeft - origin, behavior: still ? 'auto' : 'smooth' });
	}
</script>

<div class="deck" bind:this={deck} onscroll={onScroll}>
	{#each items as item (key(item))}
		<article class="deck__slide" aria-label={title(item)}>
			{@render slide(item)}
		</article>
	{/each}
</div>

{#if items.length > 1}
	<nav class="deck__dots" aria-label={label}>
		{#each items as item, i (key(item))}
			<button
				type="button"
				class="deck__dot"
				class:deck__dot--on={i === shown}
				aria-label="{title(item)}, {i + 1} z {items.length}"
				aria-current={i === shown ? 'true' : undefined}
				onclick={() => goTo(i)}
			></button>
		{/each}
	</nav>
{/if}

<style>
	/* The deck bleeds to the card's edges so a slide can be swiped from them;
	   the padding puts the slides back on the card's grid. `position` so a
	   slide's offsetLeft is measured from the deck. */
	.deck {
		position: relative;
		flex: none;
		display: flex;
		gap: var(--space-2);
		margin: 0 calc(var(--space-4) * -1);
		padding: 0 var(--space-4);
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scroll-padding: 0 var(--space-4);
		scrollbar-width: none;
	}

	.deck::-webkit-scrollbar {
		display: none;
	}

	/* A slide is a well — recessed inside the card — and one step narrower
	   than the card, so the next one shows its edge: the same rail as the
	   accounts on Zápis. */
	.deck__slide {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: calc(100% - 28px);
		padding: var(--space-1) var(--space-3) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--ground-2);
		scroll-snap-align: start;
	}

	.deck__slide:only-child {
		width: 100%;
	}

	/* One dot per slide, the current one in ink. The dot is 8 px; the target
	   around it is 24. */
	.deck__dots {
		display: flex;
		justify-content: center;
		gap: var(--space-1);
	}

	.deck__dot {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
	}

	.deck__dot::after {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--hairline);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.deck__dot--on::after {
		background: var(--ink);
	}
</style>
