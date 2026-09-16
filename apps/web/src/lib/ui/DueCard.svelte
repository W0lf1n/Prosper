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
	import Deck from './Deck.svelte';
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
	let position = $state(0);

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
				<span class="due__count">{position + 1} z {groups.length}</span>
			{:else}
				<span class="dot dot--warn" aria-hidden="true"></span>
			{/if}
		</div>

		<Deck
			items={groups}
			key={(group) => group.item.schedule.id}
			title={(group) => group.item.schedule.payee}
			label="Platby k potvrzení"
			bind:position
		>
			{#snippet slide(group)}
				{@const style = categoryStyle(category(group))}
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
			{/snippet}
		</Deck>

		{#if groups.length > 1}
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

	.edit {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
