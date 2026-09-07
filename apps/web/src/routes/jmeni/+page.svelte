<script lang="ts">
	/**
	 * Jmění — everything owned, in one number (`docs/INVESTMENTS.md` I2). A
	 * detail screen off Já.
	 *
	 * Half of the total is derived and half is stated, and the screen never
	 * lets that blur. The cash line comes off the ledger and is exact. Every
	 * holding line is a number somebody typed off a statement, so it carries
	 * the day it was true — and once a reading is older than its own cadence
	 * the total itself names the oldest date it rests on.
	 */
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import { archiveHolding, createHolding, recordValuation, updateHolding } from '$lib/db/repo';
	import { homeCurrency } from '$lib/domain/accounts';
	import {
		contributionOf,
		readHoldings,
		reminderLine,
		staleValuationFindings,
		wealthTotal,
		type Contribution,
		type HoldingReading
	} from '$lib/domain/holdings';
	import { balancesByCurrency } from '$lib/domain/ledger';
	import { DAYS, counted } from '$lib/domain/czech';
	import { formatDayHeading, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, type Minor } from '$lib/domain/money';
	import type { Account, Category, Holding, Txn, Valuation } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Explainer from '$lib/ui/Explainer.svelte';
	import HoldingSheet, { type HoldingInput } from '$lib/ui/HoldingSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import ValuationSheet from '$lib/ui/ValuationSheet.svelte';
	import { colorVar, holdingColor, shortCode } from '$lib/ui/palette';
	import { toast } from '$lib/ui/toast.svelte';

	const allAccounts = liveQuery(() => db().accounts.toArray());
	const allTxns = liveQuery(async () =>
		(await db().txns.toArray()).filter((t: Txn) => !t.isDeleted)
	);
	const allHoldings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());
	const allValuations = liveQuery(() => db().valuations.toArray());
	const fundingCategories = liveQuery(async () =>
		(await db().categories.orderBy('sortOrder').toArray()).filter(
			(c: Category) => !c.isDeleted && !c.isArchived && !c.isIncome
		)
	);

	const home = $derived(homeCurrency(($allAccounts ?? []) as Account[]));
	const cashByCurrency = $derived(
		balancesByCurrency(($allAccounts ?? []) as Account[], ($allTxns ?? []) as Txn[])
	);
	const cash = $derived(cashByCurrency.find((c) => c.code === home)?.total ?? ZERO);
	const foreignCash = $derived(cashByCurrency.filter((c) => c.code !== home));

	const readings = $derived(
		readHoldings({
			holdings: ($allHoldings ?? []) as Holding[],
			valuations: ($allValuations ?? []) as Valuation[],
			today: today()
		})
	);

	const wealth = $derived(wealthTotal({ cash, readings }));
	const due = $derived(staleValuationFindings(readings));

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

	let editingHolding = $state<Holding | null>(null);
	let holdingSheetOpen = $state(false);
	let valuing = $state<string | null>(null);

	const valuingReading = $derived(readings.find((r) => r.holding.id === valuing) ?? null);

	function openNewHolding() {
		editingHolding = null;
		holdingSheetOpen = true;
	}

	function editHolding() {
		editingHolding = valuingReading?.holding ?? null;
		if (!editingHolding) return;
		valuing = null;
		holdingSheetOpen = true;
	}

	async function saveHolding(input: HoldingInput) {
		const { value, ...fields } = input;
		if (editingHolding) {
			await updateHolding(editingHolding.id, fields);
			holdingSheetOpen = false;
			return;
		}
		const holding = await createHolding(fields);
		holdingSheetOpen = false;
		if (value === null) {
			valuing = holding.id;
			return;
		}
		await recordValuation({ holdingId: holding.id, value, date: today() });
		navigator.vibrate?.(12);
		toast.show(`„${holding.name}“ · ${formatMoney(value)}`);
	}

	async function saveValuation(value: number, date: string) {
		if (!valuing) return;
		await recordValuation({ holdingId: valuing, value: value as Minor, date });
		navigator.vibrate?.(12);
		toast.show('Hodnota zapsána');
		valuing = null;
	}

	async function archive() {
		if (!editingHolding) return;
		const name = editingHolding.name;
		await archiveHolding(editingHolding.id);
		holdingSheetOpen = false;
		editingHolding = null;
		toast.show(`„${name}“ schováno`);
	}

	/**
	 * "k 26. srpna · vloženo 118 000" for a fresh reading with a known
	 * contribution; "k 30. dubna · 120 dní" in amber once it has gone stale;
	 * the reminder's own line otherwise.
	 */
	function subLine(reading: HoldingReading): string {
		if (reading.asOf === null) return reminderLine(reading);
		const when = reading.ageDays === 0 ? 'dnes' : `k ${formatDayHeading(reading.asOf)}`;
		if (reading.isStale) return `${when} · ${counted(reading.ageDays ?? 0, DAYS)}`;
		const own = contributions.get(reading.holding.id);
		if (own && own.gap === null && own.invested !== null) {
			return `${when} · vloženo ${formatMoney(own.invested, { currency: false })}`;
		}
		return `${when} · ${reminderLine(reading)}`;
	}
</script>

<svelte:head>
	<title>Prosper — jmění</title>
</svelte:head>

<main class="page">
	<AppBar title="Jmění" />

	<section class="hero">
		<span class="label">Celkem</span>
		<span class="hero__total">{formatMoney(wealth.total)}</span>
		{#if wealth.restsOn}
			<span class="hero__stale">
				<span class="hero__dot" aria-hidden="true"></span>
				investice k {formatDayHeading(wealth.restsOn)}
			</span>
		{/if}
	</section>

	<div class="halves">
		<div class="card half">
			<span class="half__label">Na účtu</span>
			<span class="half__figure">{formatMoney(wealth.cash, { currency: false })}</span>
		</div>
		<div class="card half">
			<span class="half__label">V investicích</span>
			<span class="half__figure">{formatMoney(wealth.invested, { currency: false })}</span>
		</div>
		<!-- Foreign-currency balances stand beside the total, never inside it (Q49). -->
		{#each foreignCash as line (line.code)}
			<div class="card half">
				<span class="half__label">Na účtu · {line.code}</span>
				<span class="half__figure">{formatMoney(line.total, { code: line.code })}</span>
			</div>
		{/each}
	</div>

	{#each due as finding (finding.id)}
		{@const fix = finding.fix}
		<section class="card reminder">
			<span class="dot dot--warn" aria-hidden="true"></span>
			<div class="reminder__text">
				<p class="reminder__title">{finding.title}</p>
				<p class="hint">{finding.detail}</p>
				{#if fix?.kind === 'value-holding'}
					<button
						type="button"
						class="btn btn--primary btn--sm reminder__fix"
						onclick={() => (valuing = fix.holdingId)}
					>
						{fix.label}
					</button>
				{/if}
			</div>
		</section>
	{/each}

	{#if readings.length === 0}
		<section class="card empty">
			<p class="empty__lead">Zatím tu nic není.</p>
			<p class="hint">
				Přidej investiční účet, penzijko nebo ETF a zapiš, kolik má dneska hodnotu — app ti pak po
				zvolené době připomene, že je čas ji přepsat. Kolik do toho posíláš se počítá dál v běžných
				výdajích; sem patří jen aktuální hodnota.
			</p>
		</section>
	{:else}
		<section class="card card--list">
			{#each readings as reading (reading.holding.id)}
				{@const own = contributions.get(reading.holding.id)}
				<button
					type="button"
					class="row row--tall row--press"
					onclick={() => (valuing = reading.holding.id)}
				>
					<span class="circle" style="--c: {colorVar(holdingColor(reading.holding.kind))}">
						{shortCode(reading.holding.name)}
					</span>
					<span class="row__body">
						<span class="row__title">{reading.holding.name}</span>
						<span class="row__sub" class:row__sub--stale={reading.isStale}>{subLine(reading)}</span>
					</span>
					<span class="row__end">
						<span class="row__amount">{formatMoney(reading.value, { currency: false })}</span>
						{#if own && own.gap === null && own.growth !== null && own.growth !== 0}
							<span class="change" class:change--down={own.growth < 0}>
								{formatMoney(own.growth, { sign: 'always', currency: false })}
								{#if own.invested && own.invested > 0}
									· {own.growth > 0 ? '+' : '−'}{Math.abs(
										Math.round((own.growth / own.invested) * 1000) / 10
									)
										.toString()
										.replace('.', ',')} %
								{/if}
							</span>
						{:else if reading.change !== null && reading.change !== 0}
							<span class="change" class:change--down={reading.change < 0}>
								{formatMoney(reading.change, { sign: 'always', currency: false })}
								{#if reading.changePercent !== null && reading.changePercent !== 0}
									· {reading.changePercent > 0 ? '+' : '−'}{Math.abs(reading.changePercent)} %
								{/if}
							</span>
						{/if}
					</span>
				</button>
			{/each}
		</section>
	{/if}

	<button type="button" class="btn btn--card btn--lg btn--block" onclick={openNewHolding}>
		Přidat investici
	</button>

	{#if anySharedBucket}
		<p class="hint aside">
			Dvě investice míří do stejné kategorie, takže se nedá říct, kolik z ní šlo kam — vklady se
			proto u nich neukazují. Ťukni na investici, dej si <em>Upravit investici</em> a přiřaď každé vlastní
			kategorii, nebo jedné žádnou.
		</p>
	{/if}

	<p class="hint aside">
		<Explainer term="Růst" title="Vloženo a růst">
			<p>
				Vloženo je, co jsi tam z účtu poslal — sečteno z tvých vlastních záznamů. Růst je, o kolik
				hodnota vklady přerostla. Růst není příjem a do měsíce nevstupuje: nikdo ti ho neposlal na
				účet.
			</p>
		</Explainer>
		není příjem a do měsíce nevstupuje. Hodnoty jsou to, co jsi opsal z výpisu — nic se nikam nenačítá.
	</p>
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
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: var(--space-3) var(--space-1) var(--space-1);
	}

	.hero__total {
		font-size: var(--text-4xl);
		font-weight: 600;
		letter-spacing: var(--track-4xl);
		line-height: 1;
	}

	/* Amber: "look at this", not "something is wrong" — the total is still
	   the best available answer, it is just resting on an old number. */
	.hero__stale {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--flag);
	}

	.hero__dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--flag);
	}

	.halves {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.half {
		gap: 2px;
		padding: 14px var(--space-4);
	}

	.half__label {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.half__figure {
		font-size: 1rem;
		font-weight: 600;
	}

	.reminder {
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.reminder .dot {
		margin-top: 6px;
	}

	.reminder__text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.reminder__title {
		font-weight: 600;
	}

	.reminder__fix {
		align-self: flex-start;
		min-height: 36px;
	}

	.empty {
		gap: var(--space-2);
		padding: var(--space-5) var(--space-4);
	}

	.empty__lead {
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.row__sub--stale {
		color: var(--flag);
		font-weight: 600;
	}

	.change {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--in);
	}

	.change--down {
		color: var(--ink-2);
	}

	.aside {
		padding: 0 var(--space-1);
	}
</style>
