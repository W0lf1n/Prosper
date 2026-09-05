<script lang="ts">
	/**
	 * Já — the hub. The goal, the wealth and the settings, each a card that
	 * opens a detail screen; the three keep this tab lit while they are open.
	 *
	 */
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { db, SCHEMA_VERSION } from '$lib/db/schema';
	import { homeCurrency, inCurrency, liveAccounts } from '$lib/domain/accounts';
	import { RECORDS, counted } from '$lib/domain/czech';
	import { monthKey, today } from '$lib/domain/datetime';
	import { goalStatus, pickPrimary } from '$lib/domain/goals';
	import { readHoldings, wealthTotal } from '$lib/domain/holdings';
	import { balancesByCurrency } from '$lib/domain/ledger';
	import { ZERO, formatMoney } from '$lib/domain/money';
	import type {
		Account,
		Category,
		Goal,
		Holding,
		MonthTarget,
		Txn,
		Valuation
	} from '$lib/domain/types';
	import { readTheme } from '$lib/ui/theme';
	import { syncStatus } from '$lib/sync/status.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const allAccounts = liveQuery(() => db().accounts.toArray());
	const allTxns = liveQuery(async () =>
		(await db().txns.toArray()).filter((t: Txn) => !t.isDeleted)
	);
	const allCategories = liveQuery(() => db().categories.toArray());
	const allGoals = liveQuery(async () =>
		(await db().goals.toArray()).filter((g: Goal) => !g.isDeleted)
	);
	const allMonthTargets = liveQuery(async () =>
		(await db().monthTargets.toArray()).filter((t: MonthTarget) => !t.isDeleted)
	);
	const allHoldings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());
	const allValuations = liveQuery(() => db().valuations.toArray());
	const accountRows = $derived(liveAccounts(($allAccounts ?? []) as Account[]));
	const activeAccount = $derived(accountRows.find((a) => a.id === data.accountId) ?? null);
	const home = $derived(homeCurrency(($allAccounts ?? []) as Account[]));

	const liveCategories = $derived(
		(($allCategories ?? []) as Category[]).filter((c) => !c.isDeleted)
	);

	/** Goals are measured in the home currency over every account (Q49). */
	const goal = $derived.by(() => {
		const month = monthKey(today());
		const written = ($allMonthTargets ?? []) as MonthTarget[];
		const rows = inCurrency(($allTxns ?? []) as Txn[], ($allAccounts ?? []) as Account[], home);
		return pickPrimary(
			(($allGoals ?? []) as Goal[]).map((g) =>
				goalStatus({
					goal: g,
					txns: rows,
					categories: liveCategories.filter((c) => !c.isArchived),
					target: written.find((t) => t.goalId === g.id && t.month === month) ?? null,
					month,
					today: today()
				})
			)
		);
	});

	const wealth = $derived.by(() => {
		const accounts = ($allAccounts ?? []) as Account[];
		const cash =
			balancesByCurrency(accounts, ($allTxns ?? []) as Txn[]).find((c) => c.code === home)?.total ??
			ZERO;
		return wealthTotal({
			cash,
			readings: readHoldings({
				holdings: ($allHoldings ?? []) as Holding[],
				valuations: ($allValuations ?? []) as Valuation[],
				today: today()
			})
		});
	});

	const sync = syncStatus();
	const THEME_LABEL = { system: 'systém', light: 'světlý', dark: 'tmavý' } as const;
	const SYNC_LABEL: Record<string, string> = {
		off: 'vypnuto',
		idle: 'v pořádku',
		running: 'probíhá',
		error: 'chyba'
	};

	const settingsRows = $derived([
		{ id: 'ucty', name: 'Účty', detail: activeAccount?.name ?? '—' },
		{
			id: 'kategorie',
			name: 'Kategorie',
			detail: String(liveCategories.filter((c) => !c.isArchived).length)
		},
		{ id: 'vzhled', name: 'Vzhled', detail: THEME_LABEL[readTheme()] },
		{ id: 'synchronizace', name: 'Synchronizace', detail: SYNC_LABEL[sync.state] ?? sync.state },
		{
			id: 'data',
			name: 'Data',
			detail: `${counted(($allTxns ?? []).length, RECORDS)} · v${SCHEMA_VERSION}`
		}
	]);
</script>

<svelte:head>
	<title>Prosper — já</title>
</svelte:head>

<main class="page">
	<h1 class="title">Já</h1>

	<a class="card card--press" href={resolve('/cil')}>
		<div class="card__head">
			<span class="label">Cíl</span>
			<span class="card__go"><Icon name="chevron-right" size={18} /></span>
		</div>
		{#if goal}
			<span class="goal__name">{goal.goal.name}</span>
			<div class="goal__numbers">
				<span class="goal__saved">{formatMoney(goal.saved)}</span>
				<span class="goal__of">z {formatMoney(goal.goal.targetAmount)} · {goal.percent} %</span>
			</div>
			<div class="meter">
				<span
					class="meter__fill"
					data-tone={goal.isComplete ? 'done' : goal.isOverdue ? 'late' : 'on'}
					style="width: {goal.percent}%"
				></span>
			</div>
		{:else}
			<span class="goal__name goal__name--invite">Napsat cíl</span>
			<span class="hint">Nenapsaný cíl je jen přání — napsaný má proč, kolik a do kdy.</span>
		{/if}
	</a>

	<a class="card card--press wealth" href={resolve('/jmeni')}>
		<div class="card__head">
			<span class="label">Jmění</span>
			<span class="card__go"><Icon name="chevron-right" size={18} /></span>
		</div>
		<span class="wealth__total">{formatMoney(wealth.total)}</span>
		{#if wealth.staleCount > 0}
			<span class="wealth__stale">
				{wealth.staleCount === 1
					? '1 hodnota je stará'
					: wealth.staleCount < 5
						? `${wealth.staleCount} hodnoty jsou staré`
						: `${wealth.staleCount} hodnot je starých`}
			</span>
		{:else}
			<span class="hint">
				Na účtu {formatMoney(wealth.cash, { currency: false })} · V investicích
				{formatMoney(wealth.invested, { currency: false })}
			</span>
		{/if}
	</a>

	<section class="card card--list settings">
		<h2 class="label settings__label">Nastavení</h2>
		{#each settingsRows as row (row.id)}
			<a class="row row--short row--press" href="{resolve('/nastaveni')}#{row.id}">
				<span class="row__body">
					<span class="settings__name">{row.name}</span>
				</span>
				<span class="settings__detail">{row.detail}</span>
				<span class="card__go"><Icon name="chevron-right" size={16} /></span>
			</a>
		{/each}
	</section>
</main>

<TabBar />

<style>
	.goal__name {
		font-size: 1.25rem; /* 20 */
		font-weight: 600;
		letter-spacing: var(--track-name);
	}

	.goal__name--invite {
		color: var(--signal);
	}

	.goal__numbers {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.goal__saved {
		font-weight: 600;
	}

	.goal__of {
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.wealth {
		gap: 6px;
	}

	.wealth__total {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.wealth__stale {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--flag);
	}

	.settings {
		padding-top: var(--space-2);
	}

	.settings__label {
		padding: var(--space-2) 0 var(--space-1);
	}

	.settings__name {
		font-size: var(--text-base);
	}

	.settings__detail {
		flex: none;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}
</style>
