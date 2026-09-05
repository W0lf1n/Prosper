<script lang="ts">
	/**
	 * Přehled — the month and the standing orders, one screen with a switch.
	 *
	 * `/mesic` and `/platby` were two tabs until the third edition. Both are
	 * about the same month from two sides — what happened, and what is
	 * declared to happen — so they share a title row, the month switcher, and
	 * a pill that flips between them.
	 */
	import { liveQuery } from 'dexie';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import {
		archiveSchedule,
		confirmScheduled,
		createSchedule,
		deleteTxn,
		settleReceivable,
		skipScheduled,
		unsettleReceivable,
		updateSchedule,
		updateTxn
	} from '$lib/db/repo';
	import { summariseMonth } from '$lib/domain/checks';
	import { groupByCurrency, inCurrency, liveAccounts } from '$lib/domain/accounts';
	import { DAYS, PAYMENTS, counted, plural } from '$lib/domain/czech';
	import { formatMonthHeading, monthKey, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, type Minor } from '$lib/domain/money';
	import { openReceivables, totalOwed } from '$lib/domain/receivables';
	import { readHoldings, staleValuationFindings } from '$lib/domain/holdings';
	import { categoryTrends, TREND_WINDOW, type CategoryTrend } from '$lib/domain/trends';
	import { monthCoverage, quietStreak } from '$lib/domain/coverage';
	import { refileCandidates } from '$lib/domain/refile';
	import {
		MODE_LABEL,
		dueGroups,
		recurringCost,
		recurringIncome,
		remainingPayments,
		remainingThisMonth,
		scheduleSharesOf,
		type DueGroup
	} from '$lib/domain/recurring';
	import { prosperitySplit, verdict, type ProsperityClass } from '$lib/domain/prosperity';
	import type { Account, Category, Holding, Schedule, Txn, Valuation } from '$lib/domain/types';
	import Doughnut, { type Segment } from '$lib/ui/Doughnut.svelte';
	import DueCard from '$lib/ui/DueCard.svelte';
	import Explainer from '$lib/ui/Explainer.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import RefileSheet from '$lib/ui/RefileSheet.svelte';
	import ScheduleSheet, { type ScheduleInput } from '$lib/ui/ScheduleSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { categoryStyle, colorVar } from '$lib/ui/palette';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ── which half ──────────────────────────────────────────────────────────
	let tab = $state<'mesic' | 'platby'>(
		page.url.searchParams.get('tab') === 'platby' ? 'platby' : 'mesic'
	);

	// The whole ledger, every account: the month view owns its own account
	// switcher (Q49), so it cannot lean on the layout's single active account.
	const txns = liveQuery(async () => (await db().txns.toArray()).filter((t: Txn) => !t.isDeleted));
	const accounts = liveQuery(() => db().accounts.toArray());
	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const holdings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());
	const valuations = liveQuery(() => db().valuations.toArray());
	const schedules = liveQuery(() => db().schedules.orderBy('sortOrder').toArray());

	/* Subscribed by hand and assigned into `$state`: the month switcher used to
	   render against the empty first tick and stay there (`CLAUDE.md`). */
	let rows = $state<Txn[]>([]);
	$effect(() => {
		const subscription = txns.subscribe((value) => (rows = (value ?? []) as Txn[]));
		return () => subscription.unsubscribe();
	});

	let month = $state(monthKey(today()));

	const accountRows = $derived(liveAccounts(($accounts ?? []) as Account[]));
	const allCategories = $derived(($categories ?? []) as Category[]);
	const categoryById = $derived(new Map(allCategories.map((c) => [c.id, c])));

	// ── which account the month is about (Q49) ──────────────────────────────
	let viewChoice = $state<string | null>(null);
	const view = $derived(viewChoice ?? data.accountId ?? 'all');
	const viewAccount = $derived(
		view === 'all' ? null : (accountRows.find((a) => a.id === view) ?? null)
	);
	const currency = $derived(viewAccount?.currency ?? 'CZK');
	const viewRows = $derived(view === 'all' ? [] : rows.filter((t) => t.accountId === view));
	const dayRows = $derived(view === 'all' ? rows : viewRows);

	const currencyGroups = $derived.by(() => {
		if (view !== 'all') return [];
		return [...groupByCurrency(accountRows).keys()].map((code) => ({
			code,
			summary: summariseMonth({
				month,
				txns: inCurrency(rows, ($accounts ?? []) as Account[], code),
				categories: allCategories,
				today: today()
			})
		}));
	});

	const summary = $derived(
		summariseMonth({ month, txns: viewRows, categories: allCategories, today: today() })
	);

	const coverage = $derived(monthCoverage({ month, txns: dayRows, today: today() }));
	const streak = $derived(
		month === monthKey(today()) ? quietStreak({ txns: dayRows, today: today() }) : null
	);

	function streakLine(days: number): string {
		if (days === 0) return 'Včera se utrácelo. Série začíná od nuly.';
		return `${days} ${plural(days, DAYS)} v řadě bez výdaje.`;
	}

	// ── draining a bucket (T4) ──────────────────────────────────────────────
	let draining = $state<string | null>(null);
	const drainBucket = $derived(draining ? (categoryById.get(draining) ?? null) : null);
	const drainCandidates = $derived(
		draining
			? refileCandidates({ txns: viewRows, categories: allCategories, month, categoryId: draining })
			: []
	);

	async function refile(txnId: string, categoryId: string) {
		await updateTxn(txnId, { categoryId });
		navigator.vibrate?.(10);
	}

	/* A stale reading is a fact about a statement nobody opened, not about the
	   ledger — raised beside the month's findings, never from inside them. */
	const staleFindings = $derived(
		month === monthKey(today())
			? staleValuationFindings(
					readHoldings({
						holdings: ($holdings ?? []) as Holding[],
						valuations: ($valuations ?? []) as Valuation[],
						today: today()
					})
				)
			: []
	);

	const findings = $derived([...summary.findings, ...staleFindings]);

	const trends = $derived(
		new Map<string | null, CategoryTrend>(
			categoryTrends({
				month,
				txns: viewRows,
				categories: allCategories,
				today: today(),
				window: TREND_WINDOW
			}).map((trend) => [trend.categoryId, trend])
		)
	);

	const availableMonths = $derived(
		[...rows.map((t) => monthKey(t.date)), monthKey(today())]
			.filter((m, i, all) => all.indexOf(m) === i)
			.sort()
			.reverse()
	);
	const monthIndex = $derived(availableMonths.indexOf(month));
	const hasOlder = $derived(monthIndex >= 0 && monthIndex < availableMonths.length - 1);
	const hasNewer = $derived(monthIndex > 0);

	function step(delta: number) {
		const next = availableMonths[monthIndex + delta];
		if (next) month = next;
	}

	// ── receivables ─────────────────────────────────────────────────────────
	const receivables = $derived(openReceivables(viewRows));
	const owed = $derived(totalOwed(viewRows));

	async function markReceived(txnId: string, shareId: string) {
		const repayment = await settleReceivable(txnId, shareId);
		if (!repayment) return;
		toast.money(repayment.amount, {
			message: repayment.payee,
			code: currency,
			undo: () => unsettleReceivable(txnId, shareId)
		});
	}

	// ── the 10/10/10/70 split ───────────────────────────────────────────────
	const split = $derived(prosperitySplit({ income: summary.earned, buckets: summary.buckets }));

	const CLASS_COLOUR: Record<ProsperityClass, string> = {
		give: 'var(--split-give)',
		save: 'var(--split-save)',
		debt: 'var(--split-debt)',
		live: 'var(--split-live)'
	};

	const CLASS_SHORT: Record<ProsperityClass, string> = {
		give: 'Dávání',
		save: 'Spoření',
		debt: 'Dluhy',
		live: 'Život'
	};

	const actualSegments = $derived<Segment[]>([
		...split.slices.map((slice) => ({
			value: slice.amount,
			colour: CLASS_COLOUR[slice.cls],
			label: slice.label
		})),
		...(split.left > 0 ? [{ value: split.left, colour: 'var(--split-left)', label: 'Zbylo' }] : [])
	]);

	function deltaTone(
		cls: ProsperityClass,
		delta: number,
		amount: Minor
	): 'under' | 'over' | 'flat' {
		if (cls === 'debt' && amount === 0) return 'flat';
		if (delta < 0) return 'under';
		if (delta > 0) return 'over';
		return 'flat';
	}

	/** Width of a bucket's bar, as a share of the biggest bucket. */
	function barWidth(total: Minor): number {
		const largest = Math.abs(summary.buckets[0]?.total ?? (1 as Minor));
		return largest === 0 ? 0 : Math.round((Math.abs(total) / largest) * 100);
	}

	// ── platby ──────────────────────────────────────────────────────────────
	const liveSchedules = $derived(
		(($schedules ?? []) as Schedule[]).filter(
			(s) => !s.isDeleted && !s.isArchived && (!s.accountId || s.accountId === data.accountId)
		)
	);
	const activeAccount = $derived(accountRows.find((a) => a.id === data.accountId) ?? null);
	const payCurrency = $derived(activeAccount?.currency ?? 'CZK');

	const cost = $derived(recurringCost(liveSchedules));
	const income = $derived(recurringIncome(liveSchedules));
	const stillComing = $derived(remainingThisMonth(liveSchedules, today()));

	const due = $derived(
		dueGroups({ schedules: liveSchedules, today: today() }).filter(
			(group) => group.item.schedule.mode === 'confirm'
		)
	);

	const pickable = $derived(allCategories.filter((c) => !c.isDeleted && !c.isArchived));
	const spendingCategories = $derived(pickable.filter((c) => !c.isIncome));
	const incomeCategories = $derived(pickable.filter((c) => c.isIncome));

	function payerNames(schedule: Schedule): string {
		const names = scheduleSharesOf(schedule).map((s) => s.who.trim() || 'někdo');
		if (names.length <= 1) return names[0] ?? 'někdo';
		return `${names.slice(0, -1).join(', ')} a ${names[names.length - 1]}`;
	}

	let editing = $state<Schedule | null>(null);
	let sheetOpen = $state(false);
	let sheetIncoming = $state(false);
	const sheetCategories = $derived(sheetIncoming ? incomeCategories : spendingCategories);

	function openSchedule(schedule: Schedule | null, incoming = false) {
		editing = schedule;
		sheetIncoming = schedule ? schedule.amount > 0 : incoming;
		sheetOpen = true;
	}

	async function saveSchedule(input: ScheduleInput) {
		if (!data.accountId) return;
		const patch = { ...input, amount: input.amount as Minor };
		if (editing) await updateSchedule(editing.id, patch);
		else await createSchedule({ ...patch, accountId: data.accountId });
		sheetOpen = false;
		toast.show(editing ? 'Uloženo' : sheetIncoming ? 'Pravidelný příjem přidán' : 'Platba přidána');
	}

	async function removeSchedule() {
		if (!editing) return;
		const name = editing.payee;
		await archiveSchedule(editing.id);
		sheetOpen = false;
		toast.show(`„${name}“ zrušeno`);
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
			code: payCurrency,
			undo: () => deleteTxn(txn.id)
		});
	}

	async function skipDue(group: DueGroup) {
		await skipScheduled(group.item);
		toast.show(`„${group.item.schedule.payee}“ tenhle měsíc přeskočeno`);
	}
</script>

<svelte:head>
	<title>Prosper — přehled</title>
</svelte:head>

<main class="page">
	<div class="head">
		<h1 class="title head__title">Přehled</h1>
		{#if tab === 'mesic'}
			<div class="switcher">
				<button
					type="button"
					class="switcher__step"
					onclick={() => step(1)}
					disabled={!hasOlder}
					aria-label="Předchozí měsíc"
				>
					<Icon name="chevron-left" size={16} stroke={1.8} />
				</button>
				<span class="switcher__month">{formatMonthHeading(`${month}-01`)}</span>
				<button
					type="button"
					class="switcher__step"
					onclick={() => step(-1)}
					disabled={!hasNewer}
					aria-label="Další měsíc"
				>
					<Icon name="chevron-right" size={16} stroke={1.8} />
				</button>
			</div>
		{/if}
	</div>

	<div class="seg seg--wide" role="group" aria-label="Část přehledu">
		<button
			type="button"
			class="seg__item"
			aria-pressed={tab === 'mesic'}
			onclick={() => (tab = 'mesic')}
		>
			Měsíc
		</button>
		<button
			type="button"
			class="seg__item"
			aria-pressed={tab === 'platby'}
			onclick={() => (tab = 'platby')}
		>
			Platby
		</button>
	</div>

	{#if tab === 'mesic'}
		{#if accountRows.length > 1}
			<!-- Which account the month is about (Q49). "Vše" lays the currencies
			     side by side; it never adds them up. -->
			<nav class="accounts" aria-label="Účet">
				{#each accountRows as row (row.id)}
					<button
						type="button"
						class="btn btn--card"
						class:btn--primary={view === row.id}
						aria-pressed={view === row.id}
						onclick={() => (viewChoice = row.id)}
					>
						{row.name}
					</button>
				{/each}
				<button
					type="button"
					class="btn btn--card"
					class:btn--primary={view === 'all'}
					aria-pressed={view === 'all'}
					onclick={() => (viewChoice = 'all')}
				>
					vše
				</button>
			</nav>
		{/if}

		{#if view === 'all'}
			{#each currencyGroups as group (group.code)}
				<section class="card">
					<span class="label">{group.code}</span>
					<span class="net" class:net--in={group.summary.net > 0}>
						{formatMoney(group.summary.net, { sign: 'always', code: group.code })}
					</span>
					<div class="tiles">
						<div class="tile">
							<span class="tile__label">Přišlo</span>
							<span class="tile__figure"
								>{formatMoney(group.summary.income, { currency: false })}</span
							>
						</div>
						<div class="tile">
							<span class="tile__label">Odešlo</span>
							<span class="tile__figure">
								{formatMoney(group.summary.outflow, { sign: 'never', currency: false })}
							</span>
						</div>
					</div>
					{#if group.summary.buckets.length > 0}
						<dl class="facts">
							{#each group.summary.buckets as bucket (bucket.category?.id ?? 'none')}
								<div>
									<dt>{bucket.category?.name ?? 'bez kategorie'}</dt>
									<dd>{formatMoney(bucket.total, { code: group.code })}</dd>
								</div>
							{/each}
						</dl>
					{/if}
				</section>
			{/each}
			<p class="hint aside">
				Každá měna zvlášť. Kontrola, rozdělení příjmu a trendy běží nad jedním účtem — přepni si ho
				nahoře.
			</p>
		{:else}
			<section class="card">
				<span class="label">Zůstatek měsíce</span>
				<span class="net" class:net--in={summary.net > 0}>
					{formatMoney(summary.net, { sign: 'always', code: currency })}
				</span>
				<div class="tiles">
					<div class="tile">
						<span class="tile__label">Přišlo</span>
						<span class="tile__figure">{formatMoney(summary.income, { currency: false })}</span>
					</div>
					<div class="tile">
						<span class="tile__label">Odešlo</span>
						<span class="tile__figure">
							{formatMoney(summary.outflow, { sign: 'never', currency: false })}
						</span>
					</div>
				</div>
				{#if summary.oneOffOutflow !== 0}
					<p class="hint">
						Z toho jednorázově <strong
							>{formatMoney(summary.oneOffOutflow, { sign: 'never', code: currency })}</strong
						>. Běžný chod měsíce vyšel na
						<strong
							>{formatMoney(summary.recurringOutflow, { sign: 'never', code: currency })}</strong
						>.
					</p>
				{/if}
			</section>
		{/if}

		<!--
		  Dny bez výdaje — a Trimming figure: how many days this month cost
		  nothing at all, against days elapsed, never days in the month.
		-->
		<section class="card coverage">
			<Doughnut
				segments={[
					{ value: coverage.quiet, colour: 'var(--in)', label: 'bez výdaje' },
					{ value: coverage.spending, colour: 'transparent', label: 's výdajem' }
				]}
				size={92}
				thickness={12}
				round
				title="Dny bez výdaje"
			/>
			<div class="coverage__facts">
				<span class="label">Dny bez výdaje</span>
				<span class="coverage__count">
					{coverage.quiet}
					<span class="coverage__of">z {coverage.elapsed} {plural(coverage.elapsed, DAYS)}</span>
				</span>
				{#if streak}
					<span class="coverage__streak" class:coverage__streak--none={streak.days === 0}>
						{streakLine(streak.days)}
					</span>
				{/if}
				{#if coverage.spending > 0}
					<span class="hint coverage__gaps">
						{coverage.spending}
						{plural(coverage.spending, DAYS)} se něco utratilo. Den, na který jsi zapomněl, se dá doplnit
						ve výpisu kdykoliv potom.
					</span>
				{:else if coverage.elapsed > 0}
					<span class="hint coverage__gaps">Tenhle měsíc zatím neodešla ani koruna.</span>
				{/if}
			</div>
		</section>

		{#snippet kontrolaLabel()}
			<Explainer term="Kontrola">
				<p>
					App ti kouká přes rameno — při zápisu i nad měsícem: duplicity, záznamy bez kategorie,
					bucket, který přetéká, stará hodnota investice. Nic z toho nebrání uložení. Každý nález
					jen radí, a co jde, má opravu na jedno ťuknutí.
				</p>
			</Explainer>
		{/snippet}

		{#if findings.length > 0}
			<section class="card card--findings">
				<h2 class="label">{@render kontrolaLabel()}</h2>
				{#each findings as finding (finding.id)}
					<div class="finding">
						<span class="dot" class:dot--warn={finding.severity === 'warn'}></span>
						<div class="finding__text">
							<p class="finding__title">{finding.title}</p>
							<p class="hint">{finding.detail}</p>
							{#if finding.fix?.kind === 'value-holding'}
								<a class="btn btn--sm finding__fix" href={resolve('/jmeni')}>{finding.fix.label}</a>
							{:else if finding.fix?.kind === 'drain-bucket'}
								{@const fix = finding.fix}
								<button
									type="button"
									class="btn btn--sm finding__fix"
									onclick={() => (draining = fix.categoryId)}
								>
									{fix.label}
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</section>
		{:else if summary.outflow !== ZERO}
			<section class="card">
				<h2 class="label">{@render kontrolaLabel()}</h2>
				<p class="ok">
					<span class="circle circle--xs circle--soft"
						><Icon name="check" size={14} stroke={2.4} /></span
					>
					Nic k vytknutí. Měsíc sedí.
				</p>
			</section>
		{/if}

		{#if receivables.length > 0}
			<section class="card">
				<div class="card__head">
					<h2 class="label">Dluží mi</h2>
					<span class="owed-total">{formatMoney(owed, { code: currency })}</span>
				</div>
				{#each receivables as receivable (`${receivable.txn.id}:${receivable.share.id}`)}
					<div class="row row--short">
						<span class="row__body">
							<span class="row__title">{receivable.who}</span>
							<span class="row__sub">
								{receivable.txn.payee || 'bez popisu'} · z {formatMoney(receivable.spent, {
									code: currency
								})}
							</span>
						</span>
						<span class="row__amount">{formatMoney(receivable.amount, { code: currency })}</span>
						<button
							type="button"
							class="btn btn--sm owed-ok"
							onclick={() => markReceived(receivable.txn.id, receivable.share.id)}
						>
							Přijato
						</button>
					</div>
				{/each}
				<p class="hint">
					Zaplatil jsi celou částku, takže celá jde ze zůstatku. Tohle si jen pamatuje, kolik se má
					vrátit — až dorazí, odškrtneš to a zapíše se příjem.
				</p>
			</section>
		{/if}

		{#if view !== 'all'}
			<section class="card split-card">
				<h2 class="label">
					<Explainer term="Rozdělení příjmu">
						<p>
							Z každé koruny příjmu: 10 % dávání, 10 % spoření, 10 % dluhy, 70 % život. Kruh je tvůj
							měsíc; čísla vpravo říkají, o kolik se každý díl liší od předlohy. Měří se proti
							příjmu, ne proti výdajům — proto může něco zbýt. A zbytek je taky výsledek.
						</p>
					</Explainer>
					· 10 / 10 / 10 / 70
				</h2>

				{#if split.hasIncome}
					<div class="split">
						<Doughnut
							segments={actualSegments}
							size={120}
							thickness={14}
							title="Jak jsi rozdělil příjem"
						>
							{#snippet centre()}
								{#if split.left < 0}
									<span class="split__big split__big--over">{split.leftPercent} %</span>
									<span class="split__small">přečerpáno</span>
								{:else}
									<span class="split__big">{split.leftPercent} %</span>
									<span class="split__small">zbylo</span>
								{/if}
							{/snippet}
						</Doughnut>

						<ul class="legend">
							{#each split.slices as slice (slice.cls)}
								{@const tone = deltaTone(slice.cls, slice.delta, slice.amount)}
								<li class="legend__row">
									<span class="legend__dot" style="background: {CLASS_COLOUR[slice.cls]}"></span>
									<span class="legend__name">{CLASS_SHORT[slice.cls]}</span>
									<span class="legend__pct">{slice.percent} %</span>
									<span class="legend__delta" data-tone={tone}>
										{tone === 'flat' ? '—' : `${slice.delta > 0 ? '+' : ''}${slice.delta}`}
									</span>
								</li>
							{/each}
						</ul>
					</div>
					<p class="hint">{verdict(split)}</p>
				{:else}
					<p class="hint">{verdict(split)}</p>
				{/if}
			</section>

			<section class="card buckets">
				<h2 class="label">Kam to šlo</h2>
				{#if summary.buckets.length === 0}
					<p class="hint">Zatím žádné výdaje.</p>
				{:else}
					{#each summary.buckets as bucket (bucket.category?.id ?? 'none')}
						{@const trend = trends.get(bucket.category?.id ?? null)}
						{@const style = categoryStyle(bucket.category)}
						<div class="bucket">
							<span
								class="circle"
								style="--c: {bucket.category ? colorVar(style.color) : 'var(--flag)'}"
							>
								<Icon name={style.icon} size={18} stroke={2} />
							</span>
							<div class="bucket__body">
								<div class="bucket__head">
									<span class="bucket__name">{bucket.category?.name ?? 'bez kategorie'}</span>
									<span class="bucket__total">
										{formatMoney(bucket.total, { sign: 'never', code: currency })}
									</span>
								</div>
								<div class="meter meter--thin">
									<span
										class="meter__fill bucket__fill"
										style="width: {barWidth(bucket.total)}%; background: {bucket.category
											? colorVar(style.color)
											: 'var(--flag)'}"
									></span>
								</div>
								<div class="bucket__foot">
									<span>{bucket.share} %</span>
									<span class="bucket__note" data-up={trend?.direction === 'up'}>
										{#if trend && trend.direction !== 'flat' && trend.changePercent !== null}
											{trend.direction === 'up' ? '↑' : '↓'}
											{Math.abs(trend.changePercent)} % oproti obvyklým
											{formatMoney(trend.typical!, { sign: 'never', currency: false })}
										{:else if bucket.oneOffTotal !== 0}
											z toho 1× {formatMoney(bucket.oneOffTotal, { sign: 'never', code: currency })}
										{:else}
											{bucket.count}×
										{/if}
									</span>
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</section>
		{/if}
	{:else}
		<DueCard
			groups={due}
			categories={pickable}
			code={payCurrency}
			variant="platby"
			onconfirm={confirmDue}
			onskip={skipDue}
		/>

		<section class="card">
			<span class="label">Za rok</span>
			<span class="year">{formatMoney(cost.yearly, { sign: 'never', code: payCurrency })}</span>
			<dl class="facts">
				<div>
					<dt>Odejde za měsíc</dt>
					<dd>{formatMoney(cost.monthly, { sign: 'never', currency: false })}</dd>
				</div>
				{#if cost.reimbursed > 0}
					<div>
						<dt>Z toho se vrací</dt>
						<dd class="facts__in">
							{formatMoney(cost.reimbursed, { sign: 'never', currency: false })}
						</dd>
					</div>
					<div>
						<dt>Stojí tě to za měsíc</dt>
						<dd>{formatMoney(cost.net, { sign: 'never', currency: false })}</dd>
					</div>
				{/if}
				{#if income.rows.length > 0}
					<div>
						<dt>Přijde za měsíc</dt>
						<dd class="facts__in">
							{formatMoney(income.monthly, { sign: 'never', currency: false })}
						</dd>
					</div>
				{/if}
				<div>
					<dt>Ještě odejde tenhle měsíc</dt>
					<dd>{formatMoney(stillComing, { sign: 'never', currency: false })}</dd>
				</div>
			</dl>
		</section>

		<section class="card card--list schedules">
			<h2 class="label schedules__label">Odchází</h2>
			{#if cost.rows.length === 0}
				<p class="hint schedules__empty">
					Nic tu zatím není. Zapiš předplatné, hypotéku nebo pojištění a app ti je každý měsíc
					nabídne sama — a hlavně spočítá, na kolik přijdou za rok.
				</p>
			{:else}
				{#each cost.rows as row (row.schedule.id)}
					{@const left = remainingPayments(row.schedule, today())}
					{@const category = categoryById.get(row.schedule.categoryId) ?? null}
					{@const style = categoryStyle(category)}
					<button type="button" class="row row--press" onclick={() => openSchedule(row.schedule)}>
						<span class="circle" style="--c: {colorVar(style.color)}">
							<Icon name={style.icon} size={18} stroke={2} />
						</span>
						<span class="row__body">
							<span class="row__title">{row.schedule.payee}</span>
							<span class="row__sub">
								{row.schedule.dayOfMonth}. · {category?.name ?? '—'}
								{#if left}
									· zbývá {counted(left.payments, PAYMENTS)}
								{/if}
							</span>
							{#if row.reimbursed > 0}
								<span class="row__sub schedules__back">
									vrací {payerNames(row.schedule)}
									{formatMoney(row.reimbursed, { sign: 'never', currency: false })} · stojí
									{formatMoney(row.net, { sign: 'never', currency: false })}
								</span>
							{/if}
						</span>
						<span class="row__end">
							<span class="row__amount"
								>{formatMoney(row.monthly, { sign: 'never', currency: false })}</span
							>
							<span class="badge badge--tiny">{MODE_LABEL[row.schedule.mode]}</span>
						</span>
					</button>
				{/each}
			{/if}
			<button
				type="button"
				class="btn btn--lg btn--block schedules__add"
				onclick={() => openSchedule(null, false)}
			>
				Přidat platbu
			</button>
		</section>

		<section class="card card--list schedules">
			<h2 class="label schedules__label">Přichází</h2>
			{#if income.rows.length === 0}
				<p class="hint schedules__empty">
					Sem patří peníze, které chodí každý měsíc samy — druhá polovina hypotéky, nájem,
					pravidelná vratka. Zapisují se stejně jako platba, jen na příjmovou kategorii.
				</p>
			{:else}
				{#each income.rows as row (row.schedule.id)}
					{@const category = categoryById.get(row.schedule.categoryId) ?? null}
					{@const style = categoryStyle(category)}
					<button type="button" class="row row--press" onclick={() => openSchedule(row.schedule)}>
						<span class="circle" style="--c: {colorVar(style.color)}">
							<Icon name={style.icon} size={18} stroke={2} />
						</span>
						<span class="row__body">
							<span class="row__title">{row.schedule.payee}</span>
							<span class="row__sub">{row.schedule.dayOfMonth}. · {category?.name ?? '—'}</span>
						</span>
						<span class="row__end">
							<span class="row__amount schedules__in">
								{formatMoney(row.monthly, { sign: 'never', currency: false })}
							</span>
							<span class="badge badge--tiny">{MODE_LABEL[row.schedule.mode]}</span>
						</span>
					</button>
				{/each}
			{/if}
			<div class="schedules__foot">
				<button
					type="button"
					class="btn"
					disabled={incomeCategories.length === 0}
					onclick={() => openSchedule(null, true)}
				>
					Přidat příjem
				</button>
			</div>
			{#if incomeCategories.length === 0}
				<p class="hint schedules__empty">
					Nejdřív potřebuješ příjmovou kategorii — v <strong>Nastavení</strong> u kategorie zaškrtni „příjem“.
				</p>
			{/if}
		</section>

		<p class="hint aside">
			<strong>Potvrdit</strong> ti platbu v den splatnosti nabídne tady i na úvodní obrazovce.
			<strong>Automaticky</strong> ji zapíše samo při otevření app — jen pro částky, které se
			nemění. Vrací se ti část platby? Otevři ji a vyplň <strong>Vrací se ti část</strong>.
		</p>
	{/if}
</main>

<RefileSheet
	open={draining !== null}
	bucket={drainBucket}
	candidates={drainCandidates}
	categories={allCategories}
	onrefile={refile}
	onclose={() => (draining = null)}
/>

<ScheduleSheet
	open={sheetOpen}
	code={payCurrency}
	schedule={editing}
	categories={sheetCategories}
	onsave={saveSchedule}
	onarchive={editing ? removeSchedule : null}
	onclose={() => (sheetOpen = false)}
/>

<TabBar />

<style>
	/* ── the head ────────────────────────────────────────────────────────── */

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.head__title {
		margin: 0;
	}

	.switcher {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: var(--radius-full);
		background: var(--surface);
	}

	.switcher__step {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full);
		color: var(--ink);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.switcher__step:disabled {
		color: var(--ink-3);
		cursor: default;
	}

	.switcher__step:not(:disabled):active {
		background: var(--surface-2);
	}

	.switcher__month {
		padding: 0 var(--space-1);
		font-size: var(--text-md);
		font-weight: 600;
		white-space: nowrap;
	}

	/* ── the account switcher (Q49) ──────────────────────────────────────── */

	.accounts {
		display: flex;
		gap: var(--space-2);
		margin: 0 calc(var(--space-4) * -1);
		padding: 0 var(--space-4);
		overflow-x: auto;
	}

	.accounts .btn {
		flex: none;
		min-height: 36px;
		font-size: var(--text-sm);
	}

	/* ── the totals ──────────────────────────────────────────────────────── */

	.net {
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: var(--track-3xl);
		line-height: var(--leading-tight);
	}

	.net--in {
		color: var(--in);
	}

	.tiles {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.aside {
		padding: 0 var(--space-1);
	}

	/* ── coverage ────────────────────────────────────────────────────────── */

	.coverage {
		flex-direction: row;
		align-items: center;
		gap: var(--space-4);
	}

	.coverage__facts {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.coverage__count {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.coverage__of {
		font-size: var(--text-base);
		font-weight: 400;
		letter-spacing: var(--track-body);
		color: var(--ink-2);
	}

	/* Mint, not accent: a run of days that cost nothing is a money verdict that
	   came out right. A broken run is not a failure and gets no flag. */
	.coverage__streak {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--in);
	}

	.coverage__streak--none {
		font-weight: 400;
		color: var(--ink-2);
	}

	.coverage__gaps {
		margin-top: 2px;
	}

	/* ── findings ────────────────────────────────────────────────────────── */

	.card--findings {
		gap: 0;
		padding-bottom: var(--space-2);
	}

	.card--findings .label {
		padding-bottom: var(--space-1);
	}

	.finding {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--hairline);
	}

	.finding:last-child {
		border-bottom: none;
	}

	.finding .dot {
		margin-top: 6px;
	}

	.finding__text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.finding__title {
		font-weight: 600;
	}

	.finding__fix {
		align-self: flex-start;
		margin-top: var(--space-1);
	}

	.ok {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-md);
		color: var(--in);
	}

	/* ── receivables ─────────────────────────────────────────────────────── */

	.owed-total {
		font-weight: 600;
	}

	.owed-ok {
		background: var(--in-wash);
		color: var(--in);
	}

	/* ── the split ───────────────────────────────────────────────────────── */

	.split-card {
		gap: 14px;
	}

	.split {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.split__big {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.split__big--over {
		color: var(--danger);
	}

	.split__small {
		font-size: var(--text-2xs);
		color: var(--ink-2);
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-md);
	}

	.legend__row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.legend__dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
	}

	.legend__name {
		flex: 1;
		min-width: 0;
	}

	.legend__pct {
		font-weight: 600;
	}

	.legend__delta {
		flex: none;
		width: 28px;
		text-align: right;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.legend__delta[data-tone='under'] {
		color: var(--danger);
	}

	.legend__delta[data-tone='over'] {
		color: var(--flag);
	}

	/* ── the buckets ─────────────────────────────────────────────────────── */

	.buckets {
		gap: var(--space-1);
		padding-bottom: 6px;
	}

	.bucket {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 10px 0;
	}

	.bucket__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.bucket__head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-md);
		font-weight: 600;
	}

	.bucket__name {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bucket__total {
		flex: none;
	}

	.bucket__foot {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.bucket__note {
		min-width: 0;
		text-align: right;
	}

	/* Amber for dearer than usual; cheaper is a fact, not a celebration. */
	.bucket__note[data-up='true'] {
		color: var(--flag);
	}

	/* ── platby ──────────────────────────────────────────────────────────── */

	.year {
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: var(--track-3xl);
		line-height: var(--leading-tight);
	}

	.facts__in {
		color: var(--in);
	}

	.schedules {
		padding-top: var(--space-3);
		padding-bottom: var(--space-3);
	}

	.schedules__label {
		padding-bottom: var(--space-1);
	}

	.schedules__empty {
		padding: var(--space-2) 0;
	}

	.schedules__back {
		color: var(--in);
	}

	.schedules__in {
		color: var(--in);
	}

	.schedules__add {
		margin-top: var(--space-2);
	}

	.schedules__foot {
		display: flex;
		padding-top: var(--space-2);
	}
</style>
