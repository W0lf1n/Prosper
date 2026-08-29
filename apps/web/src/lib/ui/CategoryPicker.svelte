<script lang="ts">
	import { resolve } from '$app/paths';
	import { normalize } from '$lib/domain/vocabulary';
	import type { Category } from '$lib/domain/types';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

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
	/** How wide the fade at each end is right now: 0 where there is nothing more. */
	let fadeStart = $state(0);
	let fadeEnd = $state(0);

	const FADE = 22;

	const results = $derived.by(() => {
		const q = normalize(query);
		if (!q) return categories;
		return categories.filter((c) => normalize(c.name).includes(q));
	});

	function choose(id: string) {
		onselect(id);
		open = false;
		query = '';
	}

	/**
	 * A rail that scrolls has to say so. There is no scrollbar on a phone and
	 * there is no half-chip peeking out when the list happens to end on a
	 * boundary, so the only honest signal is the content dissolving at the edge
	 * it can still travel towards — and, just as importantly, *not* dissolving
	 * at the edge where the list really has ended.
	 */
	function measure() {
		const el = rail;
		if (!el) return;
		const travel = el.scrollWidth - el.clientWidth;
		if (travel <= 1) {
			fadeStart = 0;
			fadeEnd = 0;
			return;
		}
		fadeStart = Math.min(FADE, el.scrollLeft);
		fadeEnd = Math.min(FADE, travel - el.scrollLeft);
	}

	/**
	 * Keep the chosen bucket on screen.
	 *
	 * The rail now carries every category rather than the top three, so the one
	 * that is selected can easily be forty tablets to the right — picked from
	 * the sheet, or left over from a previous entry. Scrolled to by hand rather
	 * than by `scrollIntoView`, which is free to scroll the *page* as well and
	 * on this screen that means jolting the amount out from under the thumb.
	 */
	function reveal(id: string) {
		const el = rail;
		const chip = el?.querySelector<HTMLElement>(`[data-category="${CSS.escape(id)}"]`);
		if (!el || !chip) return;

		const left = chip.offsetLeft;
		const right = left + chip.offsetWidth;
		const margin = FADE;

		if (left - margin < el.scrollLeft) {
			el.scrollTo({ left: Math.max(0, left - margin), behavior: 'smooth' });
		} else if (right + margin > el.scrollLeft + el.clientWidth) {
			el.scrollTo({ left: right + margin - el.clientWidth, behavior: 'smooth' });
		}
	}

	/**
	 * The list itself changing — which happens when the direction switch flips
	 * and the whole vocabulary is replaced — sends the rail back to the start.
	 * A selection changing only scrolls if the chip is out of sight; deselecting
	 * (which is what saving does) leaves the rail exactly where the thumb left
	 * it, because the next expense is usually near the last one.
	 */
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

		requestAnimationFrame(measure);
	});

	$effect(() => {
		const el = rail;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

<div class="chips">
	<!--
	  A rail, not a row of quarters, and now the whole vocabulary rather than
	  the top three: ranking decides what is one tap away, but nothing is more
	  than one swipe away any more. Chips are sized to their own names, so
	  POTRAVINY is not truncated and JÍDLO does not waste half a tablet, and
	  the ones past the edge scroll under a search button that never moves —
	  it is still the way out, for the times when reading forty names is
	  slower than typing four letters.
	-->
	<div
		class="chips__rail"
		bind:this={rail}
		onscroll={measure}
		style="--fade-start: {fadeStart}px; --fade-end: {fadeEnd}px"
	>
		{#each categories as category (category.id)}
			<button
				type="button"
				class="chip"
				class:chip--on={selectedId === category.id}
				data-category={category.id}
				aria-pressed={selectedId === category.id}
				onclick={() => onselect(category.id)}
			>
				<span class="dot" data-type={category.spendType}></span>
				<span class="chip__name">{category.name}</span>
			</button>
		{/each}
	</div>

	<button
		type="button"
		class="chip chip--more"
		onclick={() => (open = true)}
		aria-label="Všechny kategorie"
	>
		<Icon name="search" size={16} />
	</button>
</div>

<Sheet {open} title="Kategorie" onclose={() => (open = false)}>
	<div class="picker">
		<label class="picker__field">
			<span class="picker__icon"><Icon name="search" size={18} /></span>
			<input
				class="picker__search"
				type="search"
				bind:value={query}
				placeholder="Hledat kategorii"
				autocomplete="off"
			/>
		</label>

		<ul class="picker__list">
			{#each results as category (category.id)}
				<li>
					<button
						type="button"
						class="picker__item"
						class:picker__item--on={selectedId === category.id}
						onclick={() => choose(category.id)}
					>
						<span class="dot" data-type={category.spendType}></span>
						<span class="picker__name">{category.name}</span>
						<span class="picker__type">
							{category.spendType === 'need'
								? 'nutné'
								: category.spendType === 'want'
									? 'chtěné'
									: category.spendType === 'give'
										? 'dávání'
										: category.spendType === 'save'
											? 'spoření'
											: 'dluh'}
						</span>
					</button>
				</li>
			{/each}
			{#if results.length === 0}
				{#if categories.length === 0}
					<!-- Every category of this direction archived: without this line the
					     sheet is a dead end — the rail holds only the search chip and the
					     save button asks for a category nobody can pick. -->
					<li class="picker__empty">
						Žádná kategorie. <a href={resolve('/settings')}>Založ první v Nastavení.</a>
					</li>
				{:else}
					<li class="picker__empty">Nic takového tu není.</li>
				{/if}
			{/if}
		</ul>
	</div>
</Sheet>

<style>
	/**
	 * The row owns no gutter of its own any more. It is one row of the
	 * transaction-context panel on the entry screen, and the panel holds the
	 * page gutter for all of them, so every control down there starts on the
	 * same left edge.
	 */
	.chips {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	/**
	 * The scroll rail.
	 *
	 * It bleeds `--space-2` to the right and pays it back as padding, so a chip
	 * being scrolled away passes under the gap next to the search button rather
	 * than stopping dead against it. `proximity` snapping, not `mandatory`: a
	 * rail of forty tablets should settle where you let go of it, not walk
	 * itself to the nearest boundary every time.
	 */
	.chips__rail {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		gap: var(--space-2);
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		margin-right: calc(var(--space-2) * -1);
		padding-right: var(--space-2);
		/**
		 * The eleven pixels the chips need above and below, held by the rail
		 * rather than by the chips — and then given straight back.
		 *
		 * A scroller clips at its padding box, and `overflow-y: hidden` was
		 * cutting the chips' expanded hit areas off flush with their own edges:
		 * a 24 px target with a 44 px target's markup. Padding opens the clip
		 * box past 44; the matching negative margin keeps the row's contribution
		 * to the panel at the 24 the chips are actually drawn at, so the
		 * overhang spends the `--control-gap` gutter rather than adding to it.
		 */
		padding-block: 11px;
		margin-block: -11px;
		scrollbar-width: none;
		/**
		 * The chips dissolve at whichever end still has somewhere to go, and
		 * sit hard against the end that does not. Both widths are driven from
		 * the scroll position rather than being fixed, so the fade also *closes*
		 * over the last twenty pixels of travel instead of hiding the final chip
		 * behind a gradient that never lifts.
		 */
		/* `black` here is an alpha stop, not a colour: a mask reads only the
		   channel, and these two stops mean "fully opaque". Nothing themed. */
		mask-image: linear-gradient(
			90deg,
			transparent 0,
			black var(--fade-start, 0px),
			black calc(100% - var(--fade-end, 0px)),
			transparent 100%
		);
	}

	.chips__rail::-webkit-scrollbar {
		display: none;
	}

	/**
	 * A tablet, not a quarter of the screen. Sized to its own name, drawn at
	 * 24 and hit at 46 — the missing pixels come off the top and bottom
	 * only, because a negative inline inset inside a scroller is scrollable
	 * width, and this one scrolls. The rail pays for them with its own
	 * `padding-block`; see above.
	 */
	.chip {
		position: relative;
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--control);
		padding: 0 var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--ink-2);
		font-size: var(--text-xs);
		font-weight: 400;
		line-height: 1.1;
		white-space: nowrap;
		scroll-snap-align: start;
		box-shadow: var(--edge);
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.chip::after {
		content: '';
		position: absolute;
		inset: -11px 0;
	}

	/**
	 * The focus ring, brought in by a pixel.
	 *
	 * The global ring is 2 px thick at a 2 px offset, which lands its outer edge
	 * exactly on the rail's clip boundary. One pixel closer and it is wholly
	 * inside the scroller with room to spare, which is cheaper than making the
	 * whole row taller to hold a ring nobody sees on a phone.
	 */
	.chips__rail .chip:focus-visible {
		outline-offset: 1px;
	}

	.chip__name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip:active {
		transform: scale(0.97);
	}

	/**
	 * Selection is a wash and an edge, not a fill.
	 *
	 * It used to be a solid mint pill, which put a second saturated signal
	 * object on a screen that already has exactly one: Uložit. Two of them and
	 * neither reads as the command. Ten per cent of the accent in the fill, the
	 * accent itself in the hairline, and the ink at full strength says "this
	 * one" just as plainly and leaves the solid mint to the button.
	 *
	 * A wash rather than a step up the luminance scale, because `--surface` is
	 * already the top of that scale in daylight: a selected chip had nowhere
	 * lighter to go and would have come out sunk instead of raised.
	 *
	 * It also leaves the spend-type dot its own colour. The mint fill used to
	 * flatten it to `--signal-ink` at 55 % — washing out need-versus-want on
	 * the one chip where the class matters most.
	 */
	.chip--on {
		background: color-mix(in srgb, var(--signal) 10%, var(--surface));
		border-color: var(--signal);
		color: var(--ink);
		font-weight: 600;
		box-shadow:
			var(--edge-strong),
			0 2px 10px var(--signal-edge);
	}

	.chip--more {
		flex: none;
		width: 30px;
		min-height: var(--control);
		padding: 0;
		color: var(--ink-3);
	}

	/* It sits outside the rail, so nothing clips it and it can reach in both
	   directions: eleven pixels up and down for the height, and out to the
	   panel's right-hand gutter for the width, where nothing collides. */
	.chip--more::after {
		inset: -11px -12px -11px -4px;
	}

	@media (hover: hover) {
		.chip:hover {
			border-color: var(--hairline-2);
			color: var(--ink);
		}

		.chip--on:hover {
			border-color: var(--signal);
		}

		.chip--more:hover {
			color: var(--ink-2);
		}
	}

	/**
	 * The spend-type dot.
	 *
	 * need / want / give / save / debt is the whole point of the Trimming law, so
	 * the class a bucket belongs to is visible before its name is read. Same five
	 * colours here, in the sheet, and in the ring on the month screen.
	 */
	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		/* `need` is the 70 % of the ring, and it is the ring's own colour here
		   too. It used to be `--ink-3`, which is the same grey by accident
		   rather than by rule. */
		background: var(--split-live);
	}

	.dot[data-type='want'] {
		background: var(--flag);
	}

	.dot[data-type='give'] {
		background: var(--split-give);
	}

	.dot[data-type='save'] {
		background: var(--in);
	}

	.dot[data-type='debt'] {
		background: var(--split-debt);
	}

	/* ── the sheet ───────────────────────────────────────────────────────── */

	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.picker__field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-inline: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.picker__field:focus-within {
		border-color: var(--signal);
	}

	.picker__icon {
		display: grid;
		place-items: center;
		color: var(--ink-3);
	}

	.picker__search {
		flex: 1;
		min-width: 0;
		min-height: var(--touch);
		border: none;
		background: none;
		font-size: var(--text-base);
		outline: none;
	}

	.picker__search::placeholder {
		color: var(--ink-3);
	}

	.picker__search::-webkit-search-cancel-button {
		filter: invert(var(--picker-invert, 0));
		opacity: 0.5;
	}

	.picker__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.picker__item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--touch-lg);
		padding-inline: var(--space-3);
		/* Transparent by default so the selected row's edge does not shift the
		   layout when it arrives. */
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.picker__item:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.picker__item:hover {
			background: var(--surface-2);
		}
	}

	/**
	 * Selection is the same wash-and-edge the rail's chips wear, for the same
	 * reason they traded their solid fill: a solid accent pill fights the one
	 * command on screen, and it flattened the type suffix to 3.8:1 besides.
	 * The dot and the suffix keep their own colours.
	 */
	.picker__item--on,
	.picker__item--on:active {
		background: color-mix(in srgb, var(--signal) 10%, var(--surface));
		border-color: var(--signal);
		color: var(--ink);
		font-weight: 600;
	}

	@media (hover: hover) {
		.picker__item--on:hover {
			background: color-mix(in srgb, var(--signal) 10%, var(--surface));
		}
	}

	.picker__name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.picker__type {
		flex: none;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.picker__empty {
		padding: var(--space-4) var(--space-3);
		font-size: var(--text-md);
		color: var(--ink-3);
	}

	.picker__empty a {
		color: var(--signal);
	}
</style>
