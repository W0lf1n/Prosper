<script lang="ts">
	/**
	 * K potvrzení — the standing orders waiting to be looked at.
	 *
	 * A card on Domů and on Přehled › Platby, and only when something is due:
	 * with nothing waiting it renders nothing at all. One *slide* per
	 * schedule, oldest month first (`dueGroups`), in a deck swiped sideways
	 * (Q71): three payments due on the same morning are three cards under one
	 * label rather than a column that pushes the goal off the screen, and each
	 * is decided on its own. Potvrdit and Přeskočit sit under the slide;
	 * tapping the row itself opens a sheet where the amount can be corrected
	 * first — the gas bill is never twice the same, and fixing one month must
	 * not rewrite the standing order.
	 */
	import { formatDayHeading } from '$lib/domain/datetime';
	import { formatMoney, parseAmount, abs, type Minor } from '$lib/domain/money';
	import type { DueGroup } from '$lib/domain/recurring';
	import type { Category } from '$lib/domain/types';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import { categoryStyle, colorVar } from './palette';

	interface Props {
		groups: DueGroup[];
		categories: Category[];
		/** Currency of the account these schedules post to. */
		code?: string;
		/** "BYDLENÍ · 15. srpna" on Domů; "15. · BYDLENÍ" on Platby. */
		variant?: 'home' | 'platby';
		onconfirm: (group: DueGroup, amount: Minor | null) => Promise<void>;
		onskip: (group: DueGroup) => Promise<void>;
	}

	let { groups, categories, code = 'CZK', variant = 'home', onconfirm, onskip }: Props = $props();

	let busy = $state<string | null>(null);
	let editing = $state<DueGroup | null>(null);
	let typed = $state('');

	// ── the deck ────────────────────────────────────────────────────────────
	//
	// Native scroll-snap does the swiping; this only keeps track of which slide
	// is under the thumb, for the counter and the dots. A confirmed slide
	// leaves the list and the browser re-snaps to whatever is nearest, so the
	// index is clamped rather than kept.
	let deck = $state<HTMLDivElement | null>(null);
	let index = $state(0);
	const shown = $derived(Math.min(index, Math.max(0, groups.length - 1)));

	function slides(): HTMLElement[] {
		return deck ? (Array.from(deck.children) as HTMLElement[]) : [];
	}

	function onScroll() {
		if (!deck) return;
		const all = slides();
		const origin = all[0]?.offsetLeft ?? 0;
		let nearest = 0;
		let distance = Infinity;
		all.forEach((slide, i) => {
			const d = Math.abs(slide.offsetLeft - origin - deck!.scrollLeft);
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
		const slide = all[i];
		if (!slide) return;
		const origin = all[0]?.offsetLeft ?? 0;
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		deck.scrollTo({ left: slide.offsetLeft - origin, behavior: still ? 'auto' : 'smooth' });
	}

	function category(group: DueGroup): Category | null {
		return categories.find((c) => c.id === group.item.schedule.categoryId) ?? null;
	}

	function sub(group: DueGroup): string {
		const name = category(group)?.name ?? '—';
		return variant === 'home'
			? `${name} · ${formatDayHeading(group.item.date)}`
			: `${group.item.schedule.dayOfMonth}. · ${name}`;
	}

	function amountTyped(): Minor | null {
		if (!editing || typed.trim() === '') return null;
		const parsed = parseAmount(typed);
		if (!parsed.ok || parsed.value === 0) return null;
		// The sign belongs to the schedule; only the magnitude is being corrected.
		return (editing.item.schedule.amount < 0 ? -abs(parsed.value) : abs(parsed.value)) as Minor;
	}

	async function confirm(group: DueGroup, amount: Minor | null) {
		busy = group.item.schedule.id;
		try {
			await onconfirm(group, amount);
		} finally {
			busy = null;
			editing = null;
			typed = '';
		}
	}

	async function skip(group: DueGroup) {
		busy = group.item.schedule.id;
		try {
			await onskip(group);
		} finally {
			busy = null;
			editing = null;
		}
	}

	async function confirmAll() {
		for (const group of [...groups]) await onconfirm(group, null);
	}
</script>

{#if groups.length > 0}
	<section class="card due">
		<div class="card__head">
			<h2 class="label">K potvrzení</h2>
			{#if groups.length > 1}
				<span class="due__count">{shown + 1} z {groups.length}</span>
			{:else}
				<span class="dot dot--warn" aria-hidden="true"></span>
			{/if}
		</div>

		<div class="due__deck" bind:this={deck} onscroll={onScroll}>
			{#each groups as group (group.item.schedule.id)}
				{@const style = categoryStyle(category(group))}
				<article class="due__slide" aria-label={group.item.schedule.payee}>
					<button
						type="button"
						class="row row--press due__row"
						onclick={() => {
							editing = group;
							typed = '';
						}}
					>
						<span class="circle" style="--c: {colorVar(style.color)}">
							<Icon name={style.icon} size={18} stroke={2} />
						</span>
						<span class="row__body">
							<span class="row__title">{group.item.schedule.payee}</span>
							<span class="row__sub">
								<span class="due__sub">{sub(group)}</span>
								{#if group.backlog > 0}
									<span class="badge badge--flag badge--tiny">+{group.backlog}</span>
								{/if}
							</span>
						</span>
						<span class="row__amount">{formatMoney(group.item.schedule.amount, { code })}</span>
					</button>

					<div class="actions actions--fill">
						<button
							type="button"
							class="btn btn--primary due__pill"
							disabled={busy !== null}
							onclick={() => confirm(group, null)}
						>
							Potvrdit
						</button>
						<button
							type="button"
							class="btn due__pill"
							disabled={busy !== null}
							onclick={() => skip(group)}
						>
							Přeskočit
						</button>
					</div>
				</article>
			{/each}
		</div>

		{#if groups.length > 1}
			<nav class="due__dots" aria-label="Platby k potvrzení">
				{#each groups as group, i (group.item.schedule.id)}
					<button
						type="button"
						class="due__dot"
						class:due__dot--on={i === shown}
						aria-label="{group.item.schedule.payee}, {i + 1} z {groups.length}"
						aria-current={i === shown ? 'true' : undefined}
						onclick={() => goTo(i)}
					></button>
				{/each}
			</nav>

			<button type="button" class="btn btn--block" disabled={busy !== null} onclick={confirmAll}>
				Potvrdit všechny
			</button>
		{/if}
	</section>
{/if}

<Sheet
	open={editing !== null}
	title={editing?.item.schedule.payee ?? ''}
	onclose={() => (editing = null)}
>
	{#if editing}
		{@const group = editing}
		<div class="edit">
			<p class="hint">
				Došel den, kdy tahle platba odchází — {formatDayHeading(group.item.date)}. Potvrď, co
				opravdu odešlo; částku můžeš přepsat.
			</p>

			<label class="field">
				<span class="field__label">Částka</span>
				<input
					class="field__input"
					inputmode="decimal"
					placeholder={formatMoney(abs(group.item.schedule.amount), { currency: false })}
					bind:value={typed}
					autocomplete="off"
				/>
			</label>

			<div class="actions actions--fill">
				<button
					type="button"
					class="btn btn--lg"
					disabled={busy !== null}
					onclick={() => skip(group)}
				>
					Přeskočit
				</button>
				<button
					type="button"
					class="btn btn--primary"
					disabled={busy !== null}
					onclick={() => confirm(group, amountTyped())}
				>
					Potvrdit
				</button>
			</div>

			<p class="hint">
				Přeskočením se měsíc uzavře bez záznamu — na to, cos už zapsal ručně, nebo na měsíc, kdy
				platba neodešla.
			</p>
		</div>
	{/if}
</Sheet>

<style>
	.due__count {
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
	}

	/* The deck bleeds to the card's edges so a slide can be swiped from them;
	   the padding puts the slides back on the card's grid. `position` so a
	   slide's offsetLeft is measured from the deck. */
	.due__deck {
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

	.due__deck::-webkit-scrollbar {
		display: none;
	}

	/* A slide is a well — recessed inside the card — and one step narrower
	   than the card, so the next one shows its edge: the same rail as the
	   accounts on Zápis. With one due there is nothing to swipe to, and it
	   takes the whole width. */
	.due__slide {
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

	.due__slide:only-child {
		width: 100%;
	}

	.due__row {
		min-height: 48px;
	}

	.due__row .row__sub {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* Flex swallows the ellipsis the row gives its sub-line; the text gets it back. */
	.due__sub {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The slide's pills are the secondary height: 40, not 48. */
	.due__pill {
		min-height: 40px;
		font-size: var(--text-md);
	}

	/* One dot per slide, the current one in ink. The dot is 8 px; the target
	   around it is 24. */
	.due__dots {
		display: flex;
		justify-content: center;
		gap: var(--space-1);
	}

	.due__dot {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
	}

	.due__dot::after {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--hairline);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.due__dot--on::after {
		background: var(--ink);
	}

	.edit {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
