<script lang="ts">
	import { haptic } from '$lib/ui/haptics';
	/**
	 * Domů — the launch route, since the third edition.
	 *
	 * The keypad moved to `/zapis`; this screen leads with the month's net
	 * figure and puts everything that used to hide in a header slab into cards
	 * a thumb can read: what is waiting to be confirmed, the goal, the wealth,
	 * the last three rows. Recording is still one tap away — the disc in the
	 * bar below. The three action pills that stood under the figure and the
	 * sliders in the corner went on 2026-09-06 (Q61): every one of them
	 * repeated a slot in the bar.
	 *
	 * Since 2026-10-18 the cards under the net and the decks are his to
	 * arrange (`domain/dashboard.ts`, a prototype): which of them, in what
	 * order, and four charts besides — the pace, the calendar, the split as
	 * meters, the balance over time. Nastavení › Domů is where they are
	 * arranged (Q95); this screen only shows them.
	 */
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import {
		confirmScheduled,
		deleteTxn,
		getHomeLayout,
		skipScheduled,
		updateTxn
	} from '$lib/db/repo';
	import { IS_DEMO } from '$lib/demo';
	import { homeCurrency, inCurrency, liveAccounts } from '$lib/domain/accounts';
	import { spendCalendar, spendPace } from '$lib/domain/charts';
	import { summariseMonth } from '$lib/domain/checks';
	import { DEFAULT_HOME, type HomeLayout, type WidgetId } from '$lib/domain/dashboard';
	import { capitalize } from '$lib/domain/czech';
	import { formatDayHeading, formatMonthHeading, monthKey, today } from '$lib/domain/datetime';
	import { goalStatus, pickPrimary, type GoalStatus } from '$lib/domain/goals';
	import { readHoldings, wealthTotal } from '$lib/domain/holdings';
	import { balancesByCurrency, openHolds } from '$lib/domain/ledger';
	import { ZERO, formatMoney, type Minor } from '$lib/domain/money';
	import { prosperitySplit } from '$lib/domain/prosperity';
	import { dueGroups, type DueGroup } from '$lib/domain/recurring';
	import type {
		Account,
		Category,
		Goal,
		Holding,
		MonthTarget,
		Schedule,
		Txn,
		Valuation
	} from '$lib/domain/types';
	import BalanceCard from '$lib/ui/BalanceCard.svelte';
	import CalendarCard from '$lib/ui/CalendarCard.svelte';
	import DueCard from '$lib/ui/DueCard.svelte';
	import HoldCard from '$lib/ui/HoldCard.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import PaceCard from '$lib/ui/PaceCard.svelte';
	import SplitCard from '$lib/ui/SplitCard.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import TxnSheet from '$lib/ui/TxnSheet.svelte';
	import { categoryStyle, colorVar } from '$lib/ui/palette';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const allAccounts = liveQuery(() => db().accounts.toArray());
	const allTxns = liveQuery(() => db().txns.toArray());
	const allCategories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const allGoals = liveQuery(async () =>
		(await db().goals.toArray()).filter((g: Goal) => !g.isDeleted)
	);
	const allMonthTargets = liveQuery(async () =>
		(await db().monthTargets.toArray()).filter((t: MonthTarget) => !t.isDeleted)
	);
	const allSchedules = liveQuery(() => db().schedules.orderBy('sortOrder').toArray());
	const allHoldings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());
	const allValuations = liveQuery(() => db().valuations.toArray());
	const accountRows = $derived(liveAccounts(($allAccounts ?? []) as Account[]));
	const activeAccount = $derived(accountRows.find((a) => a.id === data.accountId) ?? null);
	const currency = $derived(activeAccount?.currency ?? 'CZK');
	const home = $derived(homeCurrency(($allAccounts ?? []) as Account[]));
	const accountById = $derived(new Map(accountRows.map((a) => [a.id, a])));

	/* Table-wide and filtered here, so the account switch on /zapis is
	   followed by construction (`CLAUDE.md`, the liveQuery trap). */
	const liveRows = $derived((($allTxns ?? []) as Txn[]).filter((t) => !t.isDeleted));
	/* The month is the active account's currency, every account in it (Q83):
	   the card and the cash in the wallet are one koruna month, and the figure
	   must not halve because the keypad was last left on the cash. */
	const currencyTxns = $derived(inCurrency(liveRows, ($allAccounts ?? []) as Account[], currency));
	const currencyAccountIds = $derived(
		new Set(accountRows.filter((a) => a.currency === currency).map((a) => a.id))
	);

	const liveCategories = $derived(
		(($allCategories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived)
	);
	const categoryById = $derived(
		new Map((($allCategories ?? []) as Category[]).map((c) => [c.id, c]))
	);

	const summary = $derived(
		summariseMonth({
			month: monthKey(today()),
			txns: currencyTxns,
			categories: liveCategories,
			today: today()
		})
	);

	/** The `confirm` set, on this currency's accounts (Q49, Q83) — `auto` was
	    written at launch. A schedule from before accounts were plural posts to
	    the active account, which is in the currency by definition. */
	const due = $derived(
		dueGroups({ schedules: ($allSchedules ?? []) as Schedule[], today: today() }).filter(
			(group) =>
				group.item.schedule.mode === 'confirm' &&
				(!group.item.schedule.accountId || currencyAccountIds.has(group.item.schedule.accountId))
		)
	);

	// ── the arranged part ───────────────────────────────────────────────────
	/* `meta` is a table like any other, so an edit in the sheet re-renders
	   this list as it is tapped. Until it is read, Domů as it always was. */
	const storedLayout = liveQuery(() => getHomeLayout());
	const layout = $derived<HomeLayout>($storedLayout ?? { widgets: [...DEFAULT_HOME] });
	const showing = $derived(new Set<WidgetId>(layout.widgets));

	const month = $derived(monthKey(today()));
	/* Each chart is computed only while its card is on the screen. */
	const pace = $derived(
		showing.has('pace')
			? spendPace({ txns: currencyTxns, categories: liveCategories, month, today: today() })
			: null
	);
	const calendar = $derived(
		showing.has('calendar')
			? spendCalendar({ txns: currencyTxns, categories: liveCategories, month, today: today() })
			: null
	);
	/* Against earnings, not income — an exchange is not a raise (Q49). */
	const split = $derived(
		showing.has('split')
			? prosperitySplit({ income: summary.earned, buckets: summary.buckets })
			: null
	);

	/** The rows the bank has only blocked so far, in this currency (Q75, Q83). */
	const holds = $derived(openHolds(currencyTxns));

	/** Goals live in the home currency, so the card speaks only there (Q49). */
	const goal = $derived.by<GoalStatus | null>(() => {
		if (currency !== home) return null;
		const month = monthKey(today());
		const written = ($allMonthTargets ?? []) as MonthTarget[];
		return pickPrimary(
			(($allGoals ?? []) as Goal[]).map((g) =>
				goalStatus({
					goal: g,
					/* Home-currency rows of every account (Q49) — the card's and the cash's. */
					txns: currencyTxns,
					categories: liveCategories,
					target: written.find((t) => t.goalId === g.id && t.month === month) ?? null,
					month,
					today: today()
				})
			)
		);
	});

	const goalTone = $derived(
		!goal
			? 'on'
			: goal.isComplete || goal.pace === 'done'
				? 'done'
				: goal.pace === 'behind' || goal.isOverdue
					? 'behind'
					: 'on'
	);

	const wealth = $derived.by(() => {
		const accounts = ($allAccounts ?? []) as Account[];
		const cash = balancesByCurrency(accounts, liveRows).find((c) => c.code === home)?.total ?? ZERO;
		return wealthTotal({
			cash,
			readings: readHoldings({
				holdings: ($allHoldings ?? []) as Holding[],
				valuations: ($allValuations ?? []) as Valuation[],
				today: today()
			})
		});
	});

	/** The row editor Výpis uses — a recent row opens it the same way. */
	let sheet = $state<ReturnType<typeof TxnSheet>>();

	/** The last three rows, every account, newest first. */
	const recent = $derived(
		[...liveRows]
			.sort((a, b) =>
				a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1
			)
			.slice(0, 3)
	);

	function rowTitle(txn: Txn): string {
		if (txn.payee) return txn.payee;
		return (
			categoryById.get(txn.categoryId ?? '')?.name ??
			(txn.transferPairId ? 'převod' : 'bez kategorie')
		);
	}

	function rowSub(txn: Txn): string {
		const bucket =
			categoryById.get(txn.categoryId ?? '')?.name ??
			(txn.transferPairId ? 'převod' : 'bez kategorie');
		return `${bucket} · ${capitalize(formatDayHeading(txn.date))}`;
	}

	function rowColour(txn: Txn): string {
		if (txn.categoryId) return colorVar(categoryStyle(categoryById.get(txn.categoryId)).color);
		return txn.transferPairId ? 'var(--cat-stone)' : 'var(--flag)';
	}

	function rowIcon(txn: Txn) {
		if (txn.categoryId) return categoryStyle(categoryById.get(txn.categoryId)).icon;
		return txn.transferPairId ? 'repeat' : 'tag';
	}

	async function confirmDue(group: DueGroup, amount: Minor | null) {
		if (!data.accountId) return;
		const txn = await confirmScheduled(group.item, {
			accountId: data.accountId,
			amount: amount ?? undefined
		});
		haptic(12);
		toast.money(txn.amount, {
			message: group.item.schedule.payee,
			code: currency,
			undo: () => deleteTxn(txn.id)
		});
	}

	async function skipDue(group: DueGroup) {
		await skipScheduled(group.item);
		toast.show(`„${group.item.schedule.payee}“ tenhle měsíc přeskočeno`);
	}

	/** The bank posted it: the flag comes off, the amount corrected if it moved. */
	async function settleHold(txn: Txn, amount: Minor | null) {
		const settled = await updateTxn(txn.id, {
			isProvisional: false,
			...(amount !== null && amount !== txn.amount ? { amount } : {})
		});
		if (!settled) return;
		haptic(12);
		toast.money(settled.amount, {
			message: `${txn.payee || 'záznam'} · zaúčtováno`,
			code: currency,
			undo: async () => {
				await updateTxn(txn.id, { isProvisional: true, amount: txn.amount });
			}
		});
	}
</script>

<svelte:head>
	<title>Prosper</title>
</svelte:head>

<main class="page">
	<header class="top">
		<span class="month">{capitalize(formatMonthHeading(today()))}</span>
		{#if IS_DEMO}
			<span class="badge badge--flag">ukázka</span>
		{/if}
	</header>

	<section class="hero">
		<span class="label">Zůstatek měsíce</span>
		<span class="hero__net">{formatMoney(summary.net, { sign: 'always', code: currency })}</span>
		<div class="hero__legs">
			<span class="badge badge--card hero__in">
				↑ {formatMoney(summary.income, { currency: false })}
			</span>
			<span class="badge badge--card">
				↓ {formatMoney(summary.outflow, { sign: 'never', currency: false })}
			</span>
		</div>
	</section>

	<DueCard
		groups={due}
		categories={liveCategories}
		code={currency}
		onconfirm={confirmDue}
		onskip={skipDue}
	/>

	<HoldCard {holds} categories={liveCategories} code={currency} onsettle={settleHold} />

	{#snippet goalCard()}
		{#if currency === home}
			{#if goal}
				<a class="card card--press goal" href={resolve('/cil')}>
					<div class="card__head">
						<span class="label">Cíl · {goal.goal.name}</span>
						{#if goal.isComplete}
							<span class="badge badge--in">hotovo</span>
						{:else if goal.pace === 'done'}
							<span class="badge badge--in">měsíc splněn</span>
						{:else if goal.pace === 'behind'}
							<span class="badge badge--flag">pozadu</span>
						{/if}
					</div>
					<div class="goal__numbers">
						<span class="goal__saved">{formatMoney(goal.monthSaved)}</span>
						<span class="goal__of">z {formatMoney(goal.monthTarget)} tento měsíc</span>
					</div>
					<div class="meter">
						<span class="meter__fill" data-tone={goalTone} style="width: {goal.monthPercent}%"
						></span>
					</div>
				</a>
			{:else}
				<a class="card card--press goal" href={resolve('/cil')}>
					<div class="card__head">
						<span class="label">Cíl</span>
						<span class="card__go"><Icon name="chevron-right" size={18} /></span>
					</div>
					<span class="goal__invite">Napsat cíl</span>
					<span class="hint">Nenapsaný cíl je jen přání.</span>
				</a>
			{/if}
		{/if}
	{/snippet}

	{#snippet wealthCard()}
		<a class="card card--press wealth" href={resolve('/jmeni')}>
			<div class="wealth__body">
				<span class="label">Jmění celkem</span>
				<span class="wealth__total">{formatMoney(wealth.total)}</span>
				<span class="wealth__sub" class:wealth__sub--stale={wealth.staleCount > 0}>
					Na účtu {formatMoney(wealth.cash, { currency: false })} · V investicích
					{formatMoney(wealth.invested, { currency: false })}
					{#if wealth.staleCount > 0}
						· hodnota je stará
					{/if}
				</span>
			</div>
			<span class="card__go"><Icon name="chevron-right" size={18} /></span>
		</a>
	{/snippet}

	{#snippet recentCard()}
		<section class="card card--list recent">
			<div class="card__head recent__head">
				<h2 class="label">Poslední záznamy</h2>
				<a class="link" href={resolve('/vypis')}>Zobrazit vše</a>
			</div>
			{#if recent.length === 0}
				<p class="hint recent__empty">Zatím tu nic není. Zapiš první výdaj.</p>
			{:else}
				{#each recent as txn (txn.id)}
					{@const code = accountById.get(txn.accountId)?.currency ?? currency}
					<button type="button" class="row row--press row--recent" onclick={() => sheet?.open(txn)}>
						<span class="circle" style="--c: {rowColour(txn)}">
							<Icon name={rowIcon(txn)} size={18} stroke={2} />
						</span>
						<span class="row__body">
							<span class="row__title">{rowTitle(txn)}</span>
							<span class="row__sub">
								{#if txn.isProvisional}
									<span class="badge badge--tiny recent__flag">blokace</span>
								{/if}
								{rowSub(txn)}
							</span>
						</span>
						<span class="row__amount" class:row__amount--in={txn.amount > 0}>
							{formatMoney(txn.amount, { sign: 'always', code })}
						</span>
					</button>
				{/each}
			{/if}
		</section>
	{/snippet}

	<!-- The arranged part (`domain/dashboard.ts`): his cards, in his order. -->
	{#each layout.widgets as id (id)}
		{#if id === 'goal'}
			{@render goalCard()}
		{:else if id === 'wealth'}
			{@render wealthCard()}
		{:else if id === 'recent'}
			{@render recentCard()}
		{:else if id === 'pace' && pace}
			<PaceCard {pace} code={currency} />
		{:else if id === 'calendar' && calendar}
			<CalendarCard {calendar} code={currency} />
		{:else if id === 'split' && split}
			<SplitCard {split} code={currency} />
		{:else if id === 'balance'}
			<BalanceCard
				accounts={($allAccounts ?? []) as Account[]}
				txns={liveRows}
				{currency}
				today={today()}
			/>
		{/if}
	{/each}
</main>

<TabBar />

<TxnSheet
	bind:this={sheet}
	accounts={($allAccounts ?? []) as Account[]}
	categories={($allCategories ?? []) as Category[]}
	ledger={liveRows}
/>

<style>
	/* The sub-line is text and ends in an ellipsis; the badge goes first, so
	   it is the bucket that gets cut, never the flag. */
	.recent__flag {
		margin-right: 4px;
		vertical-align: middle;
	}

	.top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 48px;
	}

	.month {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	/* ── the hero ────────────────────────────────────────────────────────── */

	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: var(--space-4) var(--space-1) var(--space-2);
	}

	.hero__net {
		font-size: var(--text-hero);
		font-weight: 600;
		letter-spacing: var(--track-hero);
		line-height: 1;
		white-space: nowrap;
	}

	.hero__legs {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.hero__legs .badge {
		padding: 6px 12px;
		font-size: var(--text-sm);
	}

	.hero__in {
		color: var(--in);
	}

	/* ── the goal ────────────────────────────────────────────────────────── */

	.goal {
		gap: 10px;
	}

	.goal__numbers {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.goal__saved {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.goal__of {
		font-size: var(--text-sm);
		color: var(--ink-2);
		text-align: right;
	}

	.goal__invite {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
		color: var(--signal);
	}

	/* ── the wealth ──────────────────────────────────────────────────────── */

	.wealth {
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
	}

	.wealth__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.wealth__total {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.wealth__sub {
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.wealth__sub--stale {
		color: var(--flag);
	}

	/* ── recent ──────────────────────────────────────────────────────────── */

	.recent {
		padding-top: var(--space-2);
	}

	.recent__head {
		min-height: 40px;
	}

	.recent__empty {
		padding: var(--space-2) 0 var(--space-3);
	}

	.row--recent {
		min-height: 60px;
	}

	.row--recent + .row--recent {
		border-top: none;
	}

	.row__amount--in {
		color: var(--in);
	}
</style>
