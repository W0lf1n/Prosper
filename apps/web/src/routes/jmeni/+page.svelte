<script lang="ts">
	/**
	 * Jmění — everything owned, in one number (`docs/INVESTMENTS.md` I2).
	 *
	 * The only screen in the app that answers a *stock* question. Every other one
	 * reports a flow: what came in this month, what went out, what a bucket cost.
	 * This one says what there is.
	 *
	 * Half of the total is derived and half of it is stated, and the screen never
	 * lets that blur. The cash line comes off the ledger and is exact. Every
	 * holding line is a number somebody typed off a statement, so it carries the
	 * day it was true — and once a reading is older than its own cadence the
	 * total itself names the oldest date it rests on. A figure from June printed
	 * in August with nothing beside it is a lie, and this app does not print
	 * those.
	 *
	 * Not a tab: the bar at the bottom is the four things done repeatedly, and a
	 * stock figure read once a month is not one of them. It is reached from the
	 * entry screen's slab header, which costs that screen no height at all.
	 */
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import { archiveHolding, createHolding, recordValuation, updateHolding } from '$lib/db/repo';
	import { balanceOf } from '$lib/domain/ledger';
	import {
		contributionOf,
		readHoldings,
		wealthTotal,
		type Contribution,
		type HoldingReading
	} from '$lib/domain/holdings';
	import { formatShortDate, today } from '$lib/domain/datetime';
	import { DAYS, plural } from '$lib/domain/czech';
	import { ZERO, type Minor } from '$lib/domain/money';
	import type { Account, Category, Holding, Txn, Valuation } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Explainer from '$lib/ui/Explainer.svelte';
	import HoldingSheet, { type HoldingInput } from '$lib/ui/HoldingSheet.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Money from '$lib/ui/Money.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import ValuationSheet from '$lib/ui/ValuationSheet.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const account = liveQuery(async () =>
		data.accountId ? ((await db().accounts.get(data.accountId)) ?? null) : null
	);

	const allTxns = liveQuery(async () =>
		data.accountId
			? (await db().txns.where('accountId').equals(data.accountId).toArray()).filter(
					(t: Txn) => !t.isDeleted
				)
			: []
	);

	const allHoldings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());
	const allValuations = liveQuery(() => db().valuations.toArray());

	/** Buckets a holding may be fed from. Income categories cannot fund anything. */
	const fundingCategories = liveQuery(async () =>
		(await db().categories.orderBy('sortOrder').toArray()).filter(
			(c: Category) => !c.isDeleted && !c.isArchived && !c.isIncome
		)
	);

	/** Derived, and exact: the opening figure plus every row since. */
	const cash = $derived(
		balanceOf(($account as Account | null)?.openingBalance ?? ZERO, ($allTxns ?? []) as Txn[])
	);

	const readings = $derived(
		readHoldings({
			holdings: ($allHoldings ?? []) as Holding[],
			valuations: ($allValuations ?? []) as Valuation[],
			today: today()
		})
	);

	const wealth = $derived(wealthTotal({ cash, readings }));

	/**
	 * What went in, and what it did since — per holding, read off the ledger.
	 *
	 * Keyed rather than zipped so the markup can look one up without caring about
	 * ordering. `gap` carries the reason there is no figure, which is the Q37
	 * ruling made visible: two live holdings on one bucket means no number for
	 * either, because a number you cannot check is worse than a blank.
	 */
	const contributions = $derived.by(() => {
		const holdings = ($allHoldings ?? []) as Holding[];
		const txns = ($allTxns ?? []) as Txn[];
		return new Map<string, Contribution>(
			readings.map((reading) => [reading.holding.id, contributionOf({ reading, holdings, txns })])
		);
	});

	const anySharedBucket = $derived(
		[...contributions.values()].some((c) => c.gap === 'shared-category')
	);

	/**
	 * Two sheets, and between them the whole of a holding.
	 *
	 * `ValuationSheet` is the number — the keypad, the previous reading, the
	 * delta. `HoldingSheet` is everything the number is *about*: the name, the
	 * kind, the cadence, the bucket it is fed from, and archiving it.
	 *
	 * The second one used to live on `/nastavení`, so a holding had two editors
	 * on two screens and neither could do the other's job — a typo was fixed in
	 * Settings and a value was typed here, and nothing said so. Both are now
	 * reached from this screen: `+` in the bar opens a blank one, a row opens
	 * its value, and `Upravit investici` inside that hands over to the other.
	 */
	let editingHolding = $state<Holding | null>(null);
	let holdingSheetOpen = $state(false);
	let valuing = $state<string | null>(null);

	/* Read back out of the live list rather than held, so the sheet is looking at
	   the same reading the row behind it is. */
	const valuingReading = $derived(readings.find((r) => r.holding.id === valuing) ?? null);

	function openNewHolding() {
		editingHolding = null;
		holdingSheetOpen = true;
	}

	/* From inside the valuation sheet: one closes as the other opens. */
	function editHolding() {
		editingHolding = valuingReading?.holding ?? null;
		if (!editingHolding) return;
		valuing = null;
		holdingSheetOpen = true;
	}

	async function saveHolding(input: HoldingInput) {
		if (editingHolding) {
			await updateHolding(editingHolding.id, input);
			holdingSheetOpen = false;
			return;
		}

		const holding = await createHolding(input);
		holdingSheetOpen = false;
		// Straight into the number: a holding with no value is the empty state
		// this screen exists to get out of.
		valuing = holding.id;
	}

	async function saveValuation(value: number, date: string) {
		if (!valuing) return;
		await recordValuation({ holdingId: valuing, value: value as Minor, date });
		navigator.vibrate?.(12);
		toast.show('Hodnota zapsána');
		valuing = null;
	}

	/**
	 * Archived rather than deleted, like a category: the readings still point at
	 * it, and a value with nothing to belong to is worse than a row that stopped
	 * appearing.
	 */
	async function archive() {
		if (!editingHolding) return;
		const name = editingHolding.name;
		await archiveHolding(editingHolding.id);
		holdingSheetOpen = false;
		editingHolding = null;
		toast.show(`„${name}“ schováno`);
	}

	/** "k 3. 6. · 47 dní" — or just "dnes", when there is nothing to explain. */
	function ageLine(reading: HoldingReading): string {
		if (reading.asOf === null) return 'zatím bez hodnoty';
		if (reading.ageDays === 0) return 'dnes';
		const when = `k ${formatShortDate(reading.asOf)}`;
		if (!reading.isStale) return when;
		return `${when} · ${reading.ageDays} ${plural(reading.ageDays!, DAYS)}`;
	}
</script>

<svelte:head>
	<title>Prosper — jmění</title>
</svelte:head>

<AppBar title="Jmění">
	{#snippet trail()}
		<button type="button" class="bar-action" onclick={openNewHolding} aria-label="Přidat investici">
			<Icon name="plus" size={22} stroke={1.9} />
		</button>
	{/snippet}
</AppBar>

<main class="page">
	<section class="total slab">
		<Money value={wealth.total} size="2xl" bold colour={false} />
		<p class="total__caption u-label">celkem</p>

		<dl class="legs">
			<div class="leg">
				<dt class="leg__name">Na účtu</dt>
				<dd class="leg__value"><Money value={wealth.cash} size="base" colour={false} /></dd>
			</div>
			<div class="leg">
				<dt class="leg__name">V investicích</dt>
				<dd class="leg__value"><Money value={wealth.invested} size="base" colour={false} /></dd>
			</div>
		</dl>

		<!--
		  The total's own honesty line. It appears only when the number is partly
		  built out of readings that have gone off, and it names the oldest of
		  them — so "celkem" is never read as "right now" when it is not.
		-->
		{#if wealth.restsOn}
			<p class="rests">
				<span class="rests__dot" aria-hidden="true"></span>
				investice k {formatShortDate(wealth.restsOn)}
			</p>
		{/if}
	</section>

	{#if readings.length === 0}
		<section class="empty slab">
			<span class="empty__glyph" aria-hidden="true"><Icon name="wealth" size={26} /></span>
			<p class="empty__lead">Zatím tu nic není.</p>
			<p class="empty__note prose">
				Přidej penzijko, ETF nebo spořicí účet a zapiš, kolik má dneska hodnotu. Kolik do toho
				posíláš se počítá dál v běžných výdajích — sem patří jen to, na kolik to vyrostlo.
			</p>
			<button type="button" class="btn btn--primary" onclick={openNewHolding}>
				Přidat investici
			</button>
		</section>
	{:else}
		<ul class="holdings">
			{#each readings as reading (reading.holding.id)}
				<li>
					<button
						type="button"
						class="holding slab"
						class:holding--stale={reading.isStale}
						onclick={() => (valuing = reading.holding.id)}
					>
						<span class="holding__head">
							<span class="dot" data-kind={reading.holding.kind}></span>
							<span class="holding__name">{reading.holding.name}</span>
							<span class="holding__value">
								<Money value={reading.value} size="lg" bold colour={false} />
							</span>
						</span>

						<span class="holding__foot">
							<span
								class="holding__age"
								class:holding__age--stale={reading.isStale}
								class:holding__age--overdue={reading.isOverdue}
							>
								{#if reading.isStale}
									<span class="holding__flag" aria-hidden="true"></span>
								{/if}
								{ageLine(reading)}
							</span>

							{#if reading.change !== null && reading.change !== 0}
								<span class="holding__change">
									<Money value={reading.change} size="sm" currency={false} />
									{#if reading.changePercent !== null && reading.changePercent !== 0}
										<span class="holding__percent">
											{reading.changePercent > 0 ? '+' : '−'}{Math.abs(reading.changePercent)} %
										</span>
									{/if}
								</span>
							{/if}
						</span>

						<!--
						  Two numbers that have never been next to each other before: what
						  was put in, off the ledger, and what the value did on top of it.
						  Growth is never income and never enters the month's split — it is
						  unrealised, and nobody allocated it.
						-->
						{#if contributions.get(reading.holding.id)?.gap === null}
							{@const own = contributions.get(reading.holding.id)!}
							<span class="holding__split">
								<span class="holding__leg">
									vloženo <Money value={own.invested!} size="sm" currency={false} colour={false} />
								</span>
								<span class="holding__leg">
									růst <Money value={own.growth!} size="sm" currency={false} />
								</span>
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>

		{#if anySharedBucket}
			<p class="footnote prose">
				Dvě investice míří do stejné kategorie, takže se nedá říct, kolik z ní šlo kam — vklady se
				proto u nich neukazují. Ťukni na investici, dej si <em>Upravit investici</em> a přiřaď každé vlastní
				kategorii, nebo jedné žádnou.
			</p>
		{/if}

		<!-- The standing footnote became a vysvětlivka (restored at Petr's ask,
		     2026-08-29): the cards print the two terms, the term answers when
		     asked, and its copy carries the footnote's whole content. -->
		<div class="footnote prose">
			<Explainer term="vloženo / růst" title="Vloženo a růst">
				<p>
					Vloženo je, co jsi tam z účtu poslal — sečteno z tvých vlastních záznamů. Růst je, o kolik
					hodnota vklady přerostla. Růst není příjem a do měsíce nevstupuje: nikdo ti ho neposlal na
					účet. Hodnoty jsou to, co jsi opsal z výpisu — nic se nikam nenačítá.
				</p>
			</Explainer>
		</div>
	{/if}
</main>

<HoldingSheet
	open={holdingSheetOpen}
	holding={editingHolding}
	categories={($fundingCategories ?? []) as Category[]}
	onsave={saveHolding}
	onarchive={editingHolding ? archive : null}
	onclose={() => (holdingSheetOpen = false)}
/>

<ValuationSheet
	reading={valuingReading}
	onsave={saveValuation}
	onedit={editHolding}
	onclose={() => (valuing = null)}
/>

<TabBar />

<style>
	.page {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: 0 var(--space-3) var(--space-5);
	}

	.bar-action {
		display: grid;
		place-items: center;
		width: var(--touch);
		height: var(--touch);
		border-radius: var(--radius-full);
		color: var(--ink-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.bar-action:active {
		background: var(--surface-2);
		color: var(--ink);
	}

	@media (hover: hover) {
		.bar-action:hover {
			background: var(--surface-2);
			color: var(--ink);
		}
	}

	/* ── the total ───────────────────────────────────────────────────────
	   One number, and then its two halves under a rule. The halves are the
	   whole point: a total that does not show what it is made of is a number
	   you have to trust rather than read. */

	.total {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-5) var(--space-4) var(--space-4);
	}

	.total__caption {
		color: var(--ink-3);
	}

	.legs {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
		margin: var(--space-4) 0 0;
		padding-top: var(--space-3);
		border-top: 1px solid var(--hairline);
	}

	.leg {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.leg__name {
		font-size: var(--text-md);
		color: var(--ink-3);
	}

	.leg__value {
		margin: 0;
	}

	/* Amber, because it is the app's "look at this" and not its "something is
	   wrong": the total is still the best available answer, it is just resting
	   on a number nobody has checked for a while. */
	.rests {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		background: var(--flag-wash);
		font-size: var(--text-xs);
		color: var(--flag);
	}

	.rests__dot {
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: var(--flag);
	}

	/* ── the holdings ────────────────────────────────────────────────────
	   Each one is a whole slab and a single target: the only thing you ever
	   want to do to a holding is tell it what it is worth now. */

	.holdings {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.holding {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		text-align: left;
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.holding:active {
		transform: scale(0.99);
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.holding:hover {
			border-color: var(--hairline-2);
		}
	}

	.holding--stale {
		border-color: color-mix(in srgb, var(--flag) 34%, var(--hairline));
	}

	.holding__head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.holding__name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-base);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.holding__value {
		flex: none;
	}

	.holding__foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.holding__age {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.holding__age--stale {
		color: var(--flag);
	}

	.holding__age--overdue {
		font-weight: 600;
	}

	.holding__flag {
		flex: none;
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: currentcolor;
	}

	.holding__change {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex: none;
	}

	/*
	   The contribution pair, on its own line under the age.

	   Below rather than beside: the row's top line is the number that matters and
	   the foot already carries the as-of date, and three figures competing across
	   one line is how a card stops being readable at a glance.
	*/
	.holding__split {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		padding-block-start: var(--space-2);
		border-block-start: 1px solid var(--hairline);
		font-size: var(--text-sm);
		color: var(--ink-3);
	}

	.holding__leg {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.holding__percent {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-2xs);
		letter-spacing: var(--track-tight);
		color: var(--ink-3);
	}

	/* Same five-colour language as the spend-type dots. */
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--split-live);
	}

	.dot[data-kind='investment'] {
		background: var(--split-give);
	}

	.dot[data-kind='savings'] {
		background: var(--in);
	}

	.dot[data-kind='crypto'] {
		background: var(--flag);
	}

	/* ── empty ───────────────────────────────────────────────────────────── */

	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-4);
	}

	.empty__glyph {
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		border-radius: var(--radius-full);
		background: var(--surface-2);
		color: var(--ink-3);
	}

	.empty__lead {
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.empty__note {
		color: var(--ink-3);
	}

	.footnote {
		padding-inline: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}
</style>
