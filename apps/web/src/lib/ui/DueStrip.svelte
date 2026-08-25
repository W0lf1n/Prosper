<script lang="ts">
	/**
	 * The standing orders waiting to be looked at.
	 *
	 * One row on the entry screen, and only when something is actually due —
	 * with nothing waiting this component renders nothing at all, so the screen
	 * the five-second budget belongs to is exactly as tall as it was.
	 *
	 * It sits under the month slab rather than by the checks strip on purpose.
	 * The checks belong to the row being typed; this belongs to the ledger, the
	 * same way the totals above it do, and mixing the two would put a nag about
	 * Netflix in the middle of a half-typed amount.
	 *
	 * One instance per schedule, oldest month first (`dueGroups`). The watermark
	 * only ever moves forward, so confirming August before July would mark July
	 * settled without ever having shown it.
	 */
	import { formatDayHeading } from '$lib/domain/datetime';
	import { formatMoney, parseAmount, abs, type Minor } from '$lib/domain/money';
	import { PAYMENTS, counted } from '$lib/domain/czech';
	import type { DueGroup } from '$lib/domain/recurring';
	import Icon from './Icon.svelte';
	import Money from './Money.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		groups: DueGroup[];
		onconfirm: (group: DueGroup, amount: Minor | null) => Promise<void>;
		onskip: (group: DueGroup) => Promise<void>;
	}

	let { groups, onconfirm, onskip }: Props = $props();

	let open = $state(false);

	/** Per-row amount overrides, keyed by schedule. The gas bill is never twice
	    the same and correcting one month must not rewrite the standing order. */
	let edits = $state<Record<string, string>>({});
	let busy = $state<string | null>(null);

	const total = $derived(groups.reduce((sum, g) => sum + abs(g.item.schedule.amount), 0) as Minor);

	function amountFor(group: DueGroup): Minor | null {
		const typed = edits[group.item.schedule.id];
		if (typed === undefined || typed.trim() === '') return null;
		const parsed = parseAmount(typed);
		if (!parsed.ok || parsed.value === 0) return null;
		// The sign belongs to the schedule; only the magnitude is being corrected.
		return (group.item.schedule.amount < 0 ? -abs(parsed.value) : abs(parsed.value)) as Minor;
	}

	async function confirm(group: DueGroup) {
		busy = group.item.schedule.id;
		try {
			await onconfirm(group, amountFor(group));
			delete edits[group.item.schedule.id];
		} finally {
			busy = null;
		}
	}

	async function skip(group: DueGroup) {
		busy = group.item.schedule.id;
		try {
			await onskip(group);
		} finally {
			busy = null;
		}
	}

	async function confirmAll() {
		for (const group of [...groups]) {
			await onconfirm(group, amountFor(group));
		}
		edits = {};
		open = false;
	}
</script>

{#if groups.length > 0}
	<button type="button" class="due-strip" onclick={() => (open = true)}>
		<span class="due-strip__dot" aria-hidden="true"></span>
		<span class="due-strip__text">
			{counted(groups.length, PAYMENTS)} k potvrzení
		</span>
		<span class="due-strip__sum"><Money value={total} size="sm" sign="never" colour={false} /></span
		>
		<span class="due-strip__go" aria-hidden="true"><Icon name="chevron-right" size={15} /></span>
	</button>
{/if}

<Sheet {open} title="Pravidelné platby" onclose={() => (open = false)}>
	<div class="due">
		<p class="due__lead prose">
			Došel den, kdy tyhle platby odcházejí. Potvrď, co opravdu odešlo — částku můžeš přepsat.
		</p>

		<ul class="due__list">
			{#each groups as group (group.item.schedule.id)}
				<li class="row">
					<div class="row__head">
						<span class="row__name">{group.item.schedule.payee}</span>
						<span class="row__when">
							{formatDayHeading(group.item.date)}
							{#if group.backlog > 0}
								<span class="row__backlog">+{group.backlog}</span>
							{/if}
						</span>
					</div>

					<div class="row__body">
						<input
							class="field__input field__input--mono row__amount"
							inputmode="decimal"
							placeholder={formatMoney(abs(group.item.schedule.amount), { currency: false })}
							bind:value={
								() => edits[group.item.schedule.id] ?? '',
								(v) => (edits[group.item.schedule.id] = v)
							}
							aria-label="Částka pro {group.item.schedule.payee}"
						/>

						<button
							type="button"
							class="btn btn--quiet row__skip"
							disabled={busy !== null}
							onclick={() => skip(group)}
						>
							Přeskočit
						</button>

						<button
							type="button"
							class="btn btn--primary row__ok"
							disabled={busy !== null}
							onclick={() => confirm(group)}
						>
							Zapsat
						</button>
					</div>
				</li>
			{/each}
		</ul>

		{#if groups.length > 1}
			<button type="button" class="btn btn--block" disabled={busy !== null} onclick={confirmAll}>
				Zapsat všechny
			</button>
		{/if}

		<p class="due__note prose">
			Přeskočením se měsíc uzavře bez záznamu — na to, cos už zapsal ručně, nebo na měsíc, kdy
			platba neodešla.
		</p>
	</div>
</Sheet>

<style>
	/**
	 * A quiet flag, not an alarm. It reports that something is waiting; it does
	 * not stand between the thumb and the keypad, and it takes the amber the app
	 * already uses for "look at this" rather than a colour of its own.
	 */
	.due-strip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 var(--space-3) var(--space-2);
		padding-inline: var(--space-3);
		min-height: var(--touch);
		border: 1px solid color-mix(in srgb, var(--flag) 42%, var(--hairline));
		border-radius: var(--radius-md);
		background: var(--flag-wash);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.due-strip:active {
		background: color-mix(in srgb, var(--flag) 18%, var(--surface));
	}

	.due-strip__dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--flag);
	}

	.due-strip__text {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.due-strip__sum {
		flex: none;
		color: var(--ink-2);
	}

	.due-strip__go {
		flex: none;
		display: grid;
		place-items: center;
		color: var(--ink-3);
	}

	/* ── the sheet ───────────────────────────────────────────────────────── */

	.due {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.due__lead,
	.due__note {
		font-size: var(--text-sm);
		color: var(--ink-3);
	}

	.due__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}

	.row__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.row__name {
		font-size: var(--text-base);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row__when {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	/* How many further months this one still owes behind the one on offer. */
	.row__backlog {
		padding: 1px var(--space-2);
		border-radius: var(--radius-full);
		background: var(--flag-wash);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--flag);
	}

	.row__body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: var(--space-2);
		align-items: center;
	}

	.row__amount {
		min-width: 0;
	}

	.row__skip,
	.row__ok {
		min-height: var(--touch);
		padding-inline: var(--space-3);
		font-size: var(--text-sm);
	}
</style>
