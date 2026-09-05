<script lang="ts">
	/**
	 * Domů — the launch route, since the third edition.
	 *
	 * The keypad moved to `/zapis`; this screen leads with the month's net
	 * figure and puts everything that used to hide in a header slab into cards
	 * a thumb can read: what is waiting to be confirmed, the goal, the wealth,
	 * the last three rows. Recording is still one tap away — the primary pill
	 * here and the disc in the bar below.
	 */
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { confirmScheduled, deleteTxn, skipScheduled } from '$lib/db/repo';
	import { homeCurrency, liveAccounts } from '$lib/domain/accounts';
	import { summariseMonth } from '$lib/domain/checks';
	import { capitalize } from '$lib/domain/czech';
	import { formatDayHeading, formatMonthHeading, monthKey, today } from '$lib/domain/datetime';
	import { goalStatus, pickPrimary, type GoalStatus } from '$lib/domain/goals';
	import { readHoldings, wealthTotal } from '$lib/domain/holdings';
	import { balancesByCurrency } from '$lib/domain/ledger';
	import { ZERO, formatMoney, type Minor } from '$lib/domain/money';
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
	import DueCard from '$lib/ui/DueCard.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
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
	const accountTxns = $derived(liveRows.filter((t) => t.accountId === data.accountId));

	const liveCategories = $derived(
		(($allCategories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived)
	);
	const categoryById = $derived(
		new Map((($allCategories ?? []) as Category[]).map((c) => [c.id, c]))
	);

	const summary = $derived(
		summariseMonth({
			month: monthKey(today()),
			txns: accountTxns,
			categories: liveCategories,
			today: today()
		})
	);

	/** The `confirm` set, on this account (Q49) — `auto` was written at launch. */
	const due = $derived(
		dueGroups({ schedules: ($allSchedules ?? []) as Schedule[], today: today() }).filter(
			(group) =>
				group.item.schedule.mode === 'confirm' &&
				(!group.item.schedule.accountId || group.item.schedule.accountId === data.accountId)
		)
	);

	/** Goals live in the home currency, so the card speaks only there (Q49). */
	const goal = $derived.by<GoalStatus | null>(() => {
		if (currency !== home) return null;
		const month = monthKey(today());
		const written = ($allMonthTargets ?? []) as MonthTarget[];
		return pickPrimary(
			(($allGoals ?? []) as Goal[]).map((g) =>
				goalStatus({
					goal: g,
					txns: accountTxns,
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
		navigator.vibrate?.(12);
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
</script>

<svelte:head>
	<title>Prosper</title>
</svelte:head>

<main class="page">
	<header class="top">
		<span class="month">{capitalize(formatMonthHeading(today()))}</span>
		<a class="round" href={resolve('/nastaveni')} aria-label="Nastavení">
			<Icon name="settings" size={20} stroke={1.6} />
		</a>
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

	<div class="actions actions--fill">
		<a class="btn btn--primary" href={resolve('/zapis')}>Zapsat</a>
		<a class="btn btn--card btn--lg" href={resolve('/tape')}>Výpis</a>
		<a class="btn btn--card btn--lg" href={resolve('/prehled')}>Měsíc</a>
	</div>

	<DueCard
		groups={due}
		categories={liveCategories}
		code={currency}
		onconfirm={confirmDue}
		onskip={skipDue}
	/>

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
					<span class="meter__fill" data-tone={goalTone} style="width: {goal.monthPercent}%"></span>
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

	<section class="card card--list recent">
		<div class="card__head recent__head">
			<h2 class="label">Poslední záznamy</h2>
			<a class="link" href={resolve('/tape')}>Zobrazit vše</a>
		</div>
		{#if recent.length === 0}
			<p class="hint recent__empty">Zatím tu nic není. Zapiš první výdaj.</p>
		{:else}
			{#each recent as txn (txn.id)}
				{@const code = accountById.get(txn.accountId)?.currency ?? currency}
				<div class="row row--recent">
					<span class="circle" style="--c: {rowColour(txn)}">
						<Icon name={rowIcon(txn)} size={18} stroke={2} />
					</span>
					<span class="row__body">
						<span class="row__title">{rowTitle(txn)}</span>
						<span class="row__sub">{rowSub(txn)}</span>
					</span>
					<span class="row__amount" class:row__amount--in={txn.amount > 0}>
						{formatMoney(txn.amount, { sign: 'always', code })}
					</span>
				</div>
			{/each}
		{/if}
	</section>
</main>

<TabBar />

<style>
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
