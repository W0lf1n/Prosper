<script lang="ts">
	/**
	 * Writing down what a holding is worth today.
	 *
	 * The keypad, because this is the app's way of typing a number and a
	 * valuation is a six-digit one — a text field would mean the phone keyboard,
	 * a different layout every time, and a tap target a third of the size.
	 *
	 * The previous reading stays on screen the whole time with the delta
	 * computed live under it. It is the cheapest guard available against a
	 * fat-fingered zero, and it is the same idea as the entry screen answering
	 * "which way is this going" before the sign has been read.
	 *
	 * It starts empty rather than pre-filled. A pre-filled field invites a tap
	 * on Uložit that records last month's number as this month's, which is worse
	 * than no reading at all: it is a stale number wearing a fresh date.
	 */
	import {
		EMPTY,
		display,
		isSavable,
		pressBackspace,
		pressComma,
		pressDigit,
		toMinor,
		type AmountInput
	} from '$lib/domain/amount-input';
	import { addDays, formatDayHeading, today } from '$lib/domain/datetime';
	import { CURRENCY_SYMBOL, formatMoney, sub } from '$lib/domain/money';
	import { valuationWarning, type HoldingReading } from '$lib/domain/holdings';
	import Icon from './Icon.svelte';
	import Keypad from './Keypad.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		/** Null closes the sheet. The holding being valued when it is not. */
		reading: HoldingReading | null;
		onsave: (value: number, date: string) => void | Promise<void>;
		/** Hand over to `HoldingSheet` — what the holding *is*, rather than worth. */
		onedit: () => void;
		onclose: () => void;
	}

	let { reading, onsave, onedit, onclose }: Props = $props();

	let amount = $state<AmountInput>(EMPTY);
	let date = $state(today());

	/* A fresh sheet every time it opens onto a different holding. */
	let opened = $state<string | null>(null);
	$effect(() => {
		const id = reading?.holding.id ?? null;
		if (id === opened) return;
		opened = id;
		amount = EMPTY;
		date = today();
	});

	const value = $derived(toMinor(amount));
	const canSave = $derived(isSavable(amount));
	const previous = $derived(reading?.latest ?? null);
	const change = $derived(previous && canSave ? sub(value, previous.value) : null);
	const warning = $derived(canSave ? valuationWarning(value, previous) : null);

	function commit() {
		if (!canSave) return;
		void onsave(value, date);
	}
</script>

<Sheet open={reading !== null} title={reading?.holding.name ?? ''} {onclose}>
	{#if reading}
		<div class="valuation">
			<output class="amount">
				{display(amount)}<span class="amount__unit">{CURRENCY_SYMBOL}</span>
			</output>

			<!--
			  What it said last time, and what this reading would do to it. Both
			  lines hold their height whether or not they have anything to say, so
			  the keypad below never moves while a number is being typed.
			-->
			<div class="context">
				{#if previous}
					<p class="context__previous">
						minule {formatMoney(previous.value)} · {formatDayHeading(previous.date)}
					</p>
					<p class="context__change" class:context__change--up={(change ?? 0) > 0}>
						{#if change !== null && change !== 0}
							<Icon name={change > 0 ? 'arrow-up' : 'arrow-down'} size={15} stroke={2.4} />
							{formatMoney(change, { sign: 'never' })}
						{/if}
					</p>
				{:else}
					<p class="context__previous">První zápis hodnoty.</p>
					<p class="context__change"></p>
				{/if}
			</div>

			{#if warning}
				<p class="warning" role="status">
					<span class="warning__dot" aria-hidden="true"></span>
					{warning}
				</p>
			{/if}

			<!-- The day the number was true, which is not always the day it is
			     typed: a statement opened on the 14th for the 3rd belongs on the
			     3rd, or the reminder counts from the wrong day. -->
			<div class="dates">
				{#each [0, -1, -7] as offset (offset)}
					{@const option = addDays(today(), offset)}
					<button
						type="button"
						class="date"
						class:date--on={date === option}
						onclick={() => (date = option)}
					>
						{formatDayHeading(option)}
					</button>
				{/each}
			</div>

			<Keypad
				ondigit={(d) => (amount = pressDigit(amount, d))}
				oncomma={() => (amount = pressComma(amount))}
				onbackspace={() => (amount = pressBackspace(amount))}
				onclear={() => (amount = EMPTY)}
			/>

			<button
				type="button"
				class="btn btn--primary btn--block"
				disabled={!canSave}
				onclick={commit}
			>
				Uložit hodnotu
			</button>

			<!--
			  Everything that is not a number — the name, the cadence, the bucket
			  it is fed from, and the way out of a holding typed wrong — is one
			  sheet along. It used to be here *and* in Settings, as two different
			  dialogs that could not do each other's job: this one could archive
			  but not rename, and that one could rename but never saw a keypad.
			  One holding, one editor, reached from the screen it lives on.
			-->
			<button type="button" class="btn btn--quiet btn--block" onclick={onedit}>
				Upravit investici
			</button>
		</div>
	{/if}
</Sheet>

<style>
	.valuation {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* The same object as the entry screen's amount, one step down the scale:
	   this is a number being typed, but it is not the screen it is typed on. */
	.amount {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: var(--space-2);
		padding-block: var(--space-2);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-3xl);
		font-weight: 600;
		line-height: 1;
		letter-spacing: var(--track-display);
		color: var(--ink);
	}

	.amount__unit {
		font-size: var(--text-lg);
		color: var(--ink-3);
	}

	/* Two fixed lines, so the pad below is nailed down while typing. */
	.context {
		display: grid;
		gap: 2px;
		text-align: center;
	}

	.context__previous {
		font-size: var(--text-sm);
		color: var(--ink-3);
	}

	.context__change {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 1.2em;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-md);
		font-weight: 600;
		letter-spacing: var(--track-tight);
		color: var(--danger);
	}

	.context__change--up {
		color: var(--in);
	}

	/* It advises and gets out of the way — it never blocks the save (§13.7). */
	.warning {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid color-mix(in srgb, var(--flag) 42%, var(--hairline));
		border-radius: var(--radius-sm);
		background: var(--flag-wash);
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.warning__dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--flag);
	}

	.dates {
		display: flex;
		gap: var(--space-2);
	}

	.date {
		flex: 1;
		min-height: var(--touch);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-sm);
		font-weight: 400;
		color: var(--ink-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.date--on {
		background: color-mix(in srgb, var(--signal) 10%, var(--surface));
		border-color: var(--signal);
		color: var(--ink);
		font-weight: 600;
	}
</style>
