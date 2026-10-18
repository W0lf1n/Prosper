<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import {
		createTransfer,
		deleteTxn,
		getCollapsedMonths,
		reconcileAccount,
		setCollapsedMonths,
		type Transfer
	} from '$lib/db/repo';
	import { liveAccounts, openingTotal } from '$lib/domain/accounts';
	import { DAYS, capitalize, counted } from '$lib/domain/czech';
	import { formatDayHeading, formatMonthHeading, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, type Minor } from '$lib/domain/money';
	import { buildTape } from '$lib/domain/ledger';
	import { isOpenReceivable, isOpenShare, sharesOf } from '$lib/domain/receivables';
	import { daysSinceReconciled } from '$lib/domain/reconcile';
	import type { Account, Category, Reconciliation, Txn } from '$lib/domain/types';
	import Icon from '$lib/ui/Icon.svelte';
	import ReconcileSheet from '$lib/ui/ReconcileSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import TransferSheet, { type TransferInput } from '$lib/ui/TransferSheet.svelte';
	import TxnSheet from '$lib/ui/TxnSheet.svelte';
	import { categoryStyle, colorVar } from '$lib/ui/palette';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const account = liveQuery(async () =>
		data.accountId ? ((await db().accounts.get(data.accountId)) ?? null) : null
	);
	const allAccounts = liveQuery(() => db().accounts.toArray());

	/** Everything on this screen is one account's, in its own currency (Q49). */
	const currency = $derived($account?.currency ?? 'CZK');
	const accountRows = $derived(liveAccounts(($allAccounts ?? []) as Account[]));

	const txns = liveQuery(async () =>
		data.accountId
			? (await db().txns.where('accountId').equals(data.accountId).toArray()).filter(
					(t) => !t.isDeleted
				)
			: []
	);

	const categories = liveQuery(() => db().categories.toArray());

	const exchanges = liveQuery(() =>
		db()
			.txns.filter((t) => t.transferPairId !== null)
			.toArray()
	);

	const categoryById = $derived(new Map(($categories ?? []).map((c: Category) => [c.id, c])));

	const months = $derived(
		$account
			? buildTape($txns ?? [], { openingBalance: openingTotal($account), today: today() })
			: []
	);

	const balance = $derived(
		months[0]?.days[0]?.balance ?? ($account ? openingTotal($account) : ZERO)
	);

	// ── folded months ───────────────────────────────────────────────────────
	// Remembered in `meta` (`repo.ts`): a fold that resets every launch is
	// worse than no fold. `null` means "not read yet" and the tape waits for it.
	let collapsed = $state<string[] | null>(null);

	$effect(() => {
		void getCollapsedMonths()
			.then((keys) => (collapsed = keys))
			.catch(() => (collapsed = []));
	});

	function toggleMonth(key: string) {
		if (!collapsed) return;
		const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key];
		collapsed = next;
		void setCollapsedMonths(next);
	}

	// ── reconciliation ──────────────────────────────────────────────────────
	const reconciliations = liveQuery(() => db().reconciliations.toArray());
	let reconciling = $state(false);

	// ── transfer ────────────────────────────────────────────────────────────
	let transferring = $state(false);

	async function saveTransfer(input: TransferInput) {
		const transfer: Transfer = await createTransfer(input);
		transferring = false;
		toast.money(transfer.out.amount, {
			message: transfer.out.payee,
			code: currency,
			undo: () => deleteTxn(transfer.out.id)
		});
	}

	const sinceReconciled = $derived(
		data.accountId
			? daysSinceReconciled(($reconciliations ?? []) as Reconciliation[], data.accountId, today())
			: null
	);

	/** Captured before anything is written — the sheet compares against it. */
	const computedBalance = $derived(balance);

	const reconcileCategories = $derived(
		(($categories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived)
	);

	async function saveReconciliation(input: {
		statementBalance: Minor;
		date: string;
		adjust: boolean;
		categoryId: string | null;
	}) {
		if (!data.accountId) return;
		const result = await reconcileAccount({
			accountId: data.accountId,
			statementBalance: input.statementBalance,
			computedBalance,
			date: input.date,
			adjust: input.adjust,
			categoryId: input.categoryId
		});
		reconciling = false;
		toast.show(
			result.adjustment
				? `Vyrovnáno o ${formatMoney(result.adjustment.amount, { sign: 'never', code: currency })}`
				: 'Srovnáno s bankou'
		);
	}

	// ── edit sheet ──────────────────────────────────────────────────────────
	// One editor for a row, shared with Domů (`TxnSheet.svelte`).
	let sheet = $state<ReturnType<typeof TxnSheet>>();

	/** "Bea dluží 125,00" / "Bea a Alex dluží 250,00" — the open shares, on the row. */
	function owedLine(txn: Txn): string {
		const open = sharesOf(txn).filter(isOpenShare);
		const names = open.map((s) => s.who.trim() || 'někdo');
		const listed =
			names.length <= 1
				? (names[0] ?? 'někdo')
				: `${names.slice(0, -1).join(', ')} a ${names[names.length - 1]}`;
		const total = open.reduce((sum, s) => sum + s.amount, 0) as Minor;
		return `${listed} dluží ${formatMoney(total, { currency: false })}`;
	}

	function bucketName(txn: Txn): string {
		return (
			categoryById.get(txn.categoryId ?? '')?.name ??
			(txn.transferPairId ? 'převod' : 'bez kategorie')
		);
	}

	function rowColour(txn: Txn): string {
		if (txn.categoryId) return colorVar(categoryStyle(categoryById.get(txn.categoryId)).color);
		return txn.transferPairId ? 'var(--cat-stone)' : 'var(--flag)';
	}

	function rowIcon(txn: Txn) {
		if (txn.categoryId) return categoryStyle(categoryById.get(txn.categoryId)).icon;
		return txn.transferPairId ? 'repeat' : 'tag';
	}

	/** "Dnes", "Včera", and otherwise the day as Intl gives it. */
	function dayLabel(iso: string): string {
		const heading = formatDayHeading(iso);
		return heading === 'dnes' || heading === 'včera' ? capitalize(heading) : heading;
	}
</script>

<svelte:head>
	<title>Prosper — výpis</title>
</svelte:head>

<main class="page">
	<h1 class="title">Výpis</h1>

	<!--
	  The balance, and the one thing you can do to it: check it against the
	  bank. It lives here rather than in Settings because this is where the
	  number being checked is printed.
	-->
	<section class="card balance">
		<span class="label">{$account?.name ?? '—'}</span>
		<span class="balance__figure">{formatMoney(balance, { code: currency })}</span>
		<span class="hint">aktuální zůstatek</span>

		{#if accountRows.length > 1}
			<button type="button" class="balance__action" onclick={() => (transferring = true)}>
				<span class="link balance__label">Převod mezi účty</span>
			</button>
		{/if}

		<button type="button" class="balance__action" onclick={() => (reconciling = true)}>
			<span class="link balance__label">Srovnat s bankou</span>
			<span class="balance__age">
				{#if sinceReconciled === null}
					zatím nikdy ›
				{:else if sinceReconciled === 0}
					dnes ›
				{:else}
					před {counted(sinceReconciled, DAYS)} ›
				{/if}
			</span>
		</button>
	</section>

	{#each collapsed ? months : [] as month (month.key)}
		{@const open = !collapsed?.includes(month.key)}
		<button type="button" class="month" aria-expanded={open} onclick={() => toggleMonth(month.key)}>
			<span class="month__name">{capitalize(formatMonthHeading(month.firstDate))}</span>
			<span class="month__legs">
				<span class="badge badge--card">
					↓ {formatMoney(month.outflow, { sign: 'never', currency: false })}
				</span>
				<span class="badge badge--card month__in">
					↑ {formatMoney(month.inflow, { currency: false })}
				</span>
			</span>
			<span class="month__caret" aria-hidden="true">
				<Icon name="chevron-down" size={16} stroke={1.8} />
			</span>
		</button>

		{#each open ? month.days : [] as day (day.date)}
			<div class="day">
				<div class="day__head">
					<span class="label">{dayLabel(day.date)}</span>
					{#if day.rows.length > 0}
						<span class="label">{formatMoney(day.net, { code: currency })}</span>
					{/if}
				</div>

				<div class="card card--list">
					{#if day.rows.length === 0}
						<!--
						  Nothing on the day, so nothing was spent on it. A statement, not
						  a control — a forgotten row is fixed by typing it with its date.
						-->
						<div class="row row--short quiet">
							<span class="circle circle--soft">
								<Icon name="check" size={18} stroke={2.2} />
							</span>
							<span class="quiet__text">bez výdaje</span>
						</div>
					{:else}
						{#each day.rows as row (row.txn.id)}
							<button type="button" class="row row--press" onclick={() => sheet?.open(row.txn)}>
								<span class="circle" style="--c: {rowColour(row.txn)}">
									<Icon name={rowIcon(row.txn)} size={18} stroke={2} />
								</span>
								<span class="row__body">
									<span class="row__title">{row.txn.payee || bucketName(row.txn)}</span>
									<span class="row__sub">
										{#if row.txn.isProvisional}
											<span class="badge badge--tiny row__flag">blokace</span>
										{/if}
										<span class:row__none={!row.txn.categoryId && !row.txn.transferPairId}>
											{bucketName(row.txn)}
										</span>
										{#if isOpenReceivable(row.txn)}
											<span class="row__owed">· {owedLine(row.txn)}</span>
										{/if}
									</span>
								</span>
								<span class="row__end">
									<span class="row__amount" class:row__amount--in={row.txn.amount > 0}>
										{formatMoney(row.txn.amount, { sign: 'always', code: currency })}
									</span>
									<span class="row__note">{formatMoney(row.balance, { currency: false })}</span>
								</span>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		{/each}
	{/each}
</main>

<TabBar />

<TransferSheet
	open={transferring}
	accounts={($allAccounts ?? []) as Account[]}
	categories={($categories ?? []) as Category[]}
	exchanges={($exchanges ?? []) as Txn[]}
	defaultFromId={data.accountId}
	onsave={saveTransfer}
	onclose={() => (transferring = false)}
/>

<ReconcileSheet
	open={reconciling}
	computed={computedBalance}
	code={currency}
	accountName={$account?.name ?? 'Účet'}
	categories={reconcileCategories}
	onsave={saveReconciliation}
	onclose={() => (reconciling = false)}
/>

<TxnSheet
	bind:this={sheet}
	accounts={($allAccounts ?? []) as Account[]}
	categories={($categories ?? []) as Category[]}
	ledger={$txns ?? []}
/>

<style>
	/* ── the balance ─────────────────────────────────────────────────────── */

	.balance {
		gap: 6px;
	}

	.balance__figure {
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: var(--track-3xl);
		line-height: var(--leading-tight);
	}

	.balance__action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-2);
		padding: 14px 0 2px;
		border-top: 1px solid var(--hairline);
		text-align: left;
	}

	.balance__action + .balance__action {
		margin-top: 0;
	}

	.balance__label {
		font-size: var(--text-base);
	}

	.balance__age {
		font-size: var(--text-md);
		color: var(--ink-2);
	}

	/* ── the month row ───────────────────────────────────────────────────── */

	.month {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: var(--touch);
		padding: var(--space-2) var(--space-1) 0;
		text-align: left;
	}

	.month__name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.month__legs {
		display: flex;
		gap: 6px;
	}

	.month__in {
		color: var(--in);
	}

	.month__caret {
		display: grid;
		place-items: center;
		color: var(--ink-3);
		transition: rotate var(--dur-base) var(--ease-out);
	}

	.month[aria-expanded='false'] .month__caret {
		rotate: -90deg;
	}

	/* ── a day ───────────────────────────────────────────────────────────── */

	.day {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.day__head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-1) var(--space-1) 0;
	}

	.quiet__text {
		font-size: var(--text-base);
		color: var(--ink-2);
	}

	.row__none {
		color: var(--flag);
	}

	.row__owed {
		color: var(--flag);
	}

	/* The sub-line is text and ends in an ellipsis; the badge goes first, so
	   it is the bucket that gets cut, never the flag. */
	.row__flag {
		margin-right: 4px;
		vertical-align: middle;
	}

	.row__amount--in {
		color: var(--in);
	}
</style>
