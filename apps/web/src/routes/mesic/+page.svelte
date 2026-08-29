<script lang="ts">
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { settleReceivable, unsettleReceivable, updateTxn } from '$lib/db/repo';
	import { summariseMonth } from '$lib/domain/checks';
	import { formatMonthHeading, monthKey, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, type Minor } from '$lib/domain/money';
	import { openReceivables, totalOwed } from '$lib/domain/receivables';
	import { readHoldings, staleValuationFindings } from '$lib/domain/holdings';
	import { categoryTrends, TREND_WINDOW, type CategoryTrend } from '$lib/domain/trends';
	import { monthCoverage, quietStreak } from '$lib/domain/coverage';
	import { refileCandidates } from '$lib/domain/refile';
	import { DAYS, plural } from '$lib/domain/czech';
	import { goalStatus, paceText, pickPrimary } from '$lib/domain/goals';
	import {
		CLASS_NOTE,
		prosperitySplit,
		targetSlices,
		verdict,
		type ProsperityClass
	} from '$lib/domain/prosperity';
	import type { Category, Goal, Holding, MonthTarget, Txn, Valuation } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Doughnut, { type Segment } from '$lib/ui/Doughnut.svelte';
	import Explainer from '$lib/ui/Explainer.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Money from '$lib/ui/Money.svelte';
	import RefileSheet from '$lib/ui/RefileSheet.svelte';
	import MonthTotals from '$lib/ui/MonthTotals.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const txns = liveQuery(async () =>
		data.accountId
			? (await db().txns.where('accountId').equals(data.accountId).toArray()).filter(
					(t: Txn) => !t.isDeleted
				)
			: []
	);
	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const goals = liveQuery(async () =>
		(await db().goals.toArray()).filter((g: Goal) => !g.isDeleted)
	);
	const monthTargets = liveQuery(async () =>
		(await db().monthTargets.toArray()).filter((t: MonthTarget) => !t.isDeleted)
	);
	const holdings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());
	const valuations = liveQuery(() => db().valuations.toArray());

	/**
	 * Subscribed by hand rather than through the `$txns` auto-subscription.
	 *
	 * The month switcher lives in the header, and with the `$` form the header's
	 * bindings never saw the live query resolve: they rendered against the empty
	 * first tick and stayed there — `store=0` in the header while `<main>` was
	 * drawing five buckets from the same query. The back arrow was therefore
	 * stamped `disabled` on load and every earlier month was unreachable.
	 *
	 * Assigning to `$state` invalidates every reader on the page unconditionally,
	 * which is the property this needs. Everything here derives from `rows`.
	 */
	let rows = $state<Txn[]>([]);

	$effect(() => {
		const subscription = txns.subscribe((value) => (rows = (value ?? []) as Txn[]));
		return () => subscription.unsubscribe();
	});

	let month = $state(monthKey(today()));

	const summary = $derived(
		summariseMonth({
			month,
			txns: rows,
			categories: ($categories ?? []) as Category[],
			today: today()
		})
	);

	/**
	 * How many days this month cost nothing.
	 *
	 * Against days **elapsed**, never days in the month — otherwise the 3rd is a
	 * verdict on 28 days that have not happened. It used to count days
	 * *recorded* against days elapsed, which was the Tracking law reporting on
	 * itself; that question died with the day mark on 2026-08-28, and this is
	 * the one that survived it.
	 */
	const coverage = $derived(monthCoverage({ month, txns: rows, today: today() }));

	/** Only meaningful for the month you are actually in. */
	const streak = $derived(
		month === monthKey(today()) ? quietStreak({ txns: rows, today: today() }) : null
	);

	// ── draining a bucket (T4) ──────────────────────────────────────────────
	//
	// `other-overflow` has been able to state the problem since P1 and do nothing
	// about it. This is the doing.
	let draining = $state<string | null>(null);

	const drainBucket = $derived(
		draining ? ((($categories ?? []) as Category[]).find((c) => c.id === draining) ?? null) : null
	);

	/**
	 * Re-derived from `rows`, so the sheet's list shrinks as each row is moved.
	 * Watching the bucket empty is the whole reward this offers.
	 */
	const drainCandidates = $derived(
		draining
			? refileCandidates({
					txns: rows,
					categories: ($categories ?? []) as Category[],
					month,
					categoryId: draining
				})
			: []
	);

	async function refile(txnId: string, categoryId: string) {
		await updateTxn(txnId, { categoryId });
		navigator.vibrate?.(10);
	}

	function streakLine(days: number): string {
		if (days === 0) return 'Včera se utrácelo. Série začíná od nuly.';
		return `${days} ${plural(days, DAYS)} v řadě bez výdaje.`;
	}

	/**
	 * The month's findings, plus anything the holdings have to say.
	 *
	 * Concatenated here rather than inside `summariseMonth`, and that is not a
	 * detail: `summariseMonth` must stay unable to see a holding, or a valuation
	 * could reach income and the 10/10/10/70 split becomes fiction
	 * (`INVESTMENTS.md` §1). A stale reading is a fact about a *statement nobody
	 * opened*, not about the ledger — so it is raised beside the month's
	 * findings, never from inside them.
	 *
	 * Only on the current month: a stale valuation is a thing to do now, and
	 * telling somebody in August that a reading was old in May is noise.
	 */
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

	/**
	 * What each bucket usually costs, so this month has something to be read
	 * against. Keyed by category so the ranking can look its own row up.
	 *
	 * `typical` is the mean of the earlier months in the window, one-offs
	 * excluded — a front door is not what a month costs. A bucket with no
	 * history gets no verdict rather than a confident-looking one.
	 */
	const trends = $derived(
		new Map<string | null, CategoryTrend>(
			categoryTrends({
				month,
				txns: rows,
				categories: ($categories ?? []) as Category[],
				today: today(),
				window: TREND_WINDOW
			}).map((trend) => [trend.categoryId, trend])
		)
	);

	/** Months that actually contain something, newest first, plus this one. */
	const monthsWithData = $derived(rows.map((t) => monthKey(t.date)));

	const availableMonths = $derived(
		[...monthsWithData, monthKey(today())]
			.filter((m, i, all) => all.indexOf(m) === i)
			.sort()
			.reverse()
	);

	/** Where the shown month sits in the list, newest first. */
	const monthIndex = $derived(availableMonths.indexOf(month));
	const hasOlder = $derived(monthIndex >= 0 && monthIndex < availableMonths.length - 1);
	const hasNewer = $derived(monthIndex > 0);

	function step(delta: number) {
		const next = availableMonths[monthIndex + delta];
		if (next) month = next;
	}

	/**
	 * The goal, on the month it belongs to (§2.2). The entry screen carries a
	 * one-line reminder; this is where the month is actually reviewed, so the
	 * target belongs beside the totals it competed with.
	 */
	const goal = $derived.by(() => {
		const written = ($monthTargets ?? []) as MonthTarget[];
		return pickPrimary(
			(($goals ?? []) as Goal[]).map((g) =>
				goalStatus({
					goal: g,
					txns: rows,
					categories: ($categories ?? []) as Category[],
					target: written.find((t) => t.goalId === g.id && t.month === month) ?? null,
					month,
					today: today()
				})
			)
		);
	});

	/** Outstanding across the whole book, not just this month — a debt has no month. */
	const receivables = $derived(openReceivables(rows));
	const owed = $derived(totalOwed(rows));

	async function markReceived(txnId: string) {
		const repayment = await settleReceivable(txnId);
		if (!repayment) return;
		toast.money(repayment.amount, {
			message: repayment.payee,
			undo: () => unsettleReceivable(txnId)
		});
	}

	// ── the 10/10/10/70 split ───────────────────────────────────────────────

	const split = $derived(prosperitySplit({ income: summary.income, buckets: summary.buckets }));

	const CLASS_COLOUR: Record<ProsperityClass, string> = {
		give: 'var(--split-give)',
		save: 'var(--split-save)',
		debt: 'var(--split-debt)',
		live: 'var(--split-live)'
	};

	/**
	 * Drawn from the amounts, not the percentages.
	 *
	 * What is left over is a segment too — that is the whole reason the ring is
	 * measured against income rather than against outflow.
	 */
	const actualSegments = $derived<Segment[]>([
		...split.slices.map((slice) => ({
			value: slice.amount,
			colour: CLASS_COLOUR[slice.cls],
			label: slice.label
		})),
		...(split.left > 0 ? [{ value: split.left, colour: 'var(--split-left)', label: 'Zbylo' }] : [])
	]);

	const targetSegments = $derived<Segment[]>(
		targetSlices().map((slice) => ({
			value: slice.percent,
			colour: CLASS_COLOUR[slice.cls],
			label: slice.label
		}))
	);

	/** Width of a bucket's bar, as a share of the biggest bucket. */
	function barWidth(total: Minor): number {
		const largest = Math.abs(summary.buckets[0]?.total ?? (1 as Minor));
		return largest === 0 ? 0 : Math.round((Math.abs(total) / largest) * 100);
	}
</script>

<svelte:head>
	<title>Prosper — měsíc</title>
</svelte:head>

<AppBar>
	{#snippet heading()}
		<div class="switcher">
			<button
				type="button"
				class="switcher__step"
				onclick={() => step(1)}
				disabled={!hasOlder}
				aria-label="Předchozí měsíc"
			>
				<Icon name="chevron-left" size={20} />
			</button>
			<h1>{formatMonthHeading(`${month}-01`)}</h1>
			<button
				type="button"
				class="switcher__step"
				onclick={() => step(-1)}
				disabled={!hasNewer}
				aria-label="Další měsíc"
			>
				<Icon name="chevron-right" size={20} />
			</button>
		</div>
	{/snippet}
</AppBar>

<MonthTotals
	month={summary.month}
	income={summary.income}
	outflow={summary.outflow}
	net={summary.net}
/>

<main class="page">
	{#if summary.oneOffOutflow !== 0}
		<p class="aside prose">
			Z toho jednorázově <strong>{formatMoney(summary.oneOffOutflow, { sign: 'never' })}</strong>.
			Běžný chod měsíce vyšel na
			<strong>{formatMoney(summary.recurringOutflow, { sign: 'never' })}</strong>.
		</p>
	{/if}

	{#if goal}
		<a class="card card--goal" href={resolve('/cil')}>
			<div class="card__head">
				<h2 class="u-label">Cíl · {goal.goal.name}</h2>
				<span class="card__go"><Icon name="chevron-right" size={16} /></span>
			</div>

			<p class="goal__why">{goal.goal.why}</p>

			<div class="goal__numbers">
				<Money value={goal.monthSaved} size="lg" bold colour={false} />
				<span class="goal__of">z {formatMoney(goal.monthTarget)}</span>
			</div>

			<div class="meter meter--thick">
				<span class="meter__fill" data-pace={goal.pace} style="width: {goal.monthPercent}%"></span>
			</div>

			<p class="goal__pace" data-pace={goal.pace}>{paceText(goal)}</p>
		</a>
	{/if}

	<!--
	  Dny bez výdaje.

	  This card used to be "Zápisy": days recorded against days elapsed, the
	  Tracking law marking its own homework. That question stopped existing on
	  2026-08-28, when a day with nothing on it became a day that cost nothing
	  rather than a hole — the report card would have read 100 % for ever.

	  What is left is a Trimming figure and a better one: how many days this
	  month you did not spend anything at all. It keeps its place above Kontrola,
	  because it is a statement about the month as a whole rather than one of the
	  month's findings.
	-->
	<section class="card coverage">
		<h2 class="u-label">Dny bez výdaje</h2>

		<div class="coverage__body">
			<Doughnut
				segments={[
					{ value: coverage.quiet, colour: 'var(--in)', label: 'bez výdaje' },
					{ value: coverage.spending, colour: 'var(--split-left)', label: 's výdajem' }
				]}
				size={104}
				thickness={14}
				title="Dny bez výdaje"
			>
				{#snippet centre()}
					<span class="coverage__percent">{coverage.percent}&nbsp;%</span>
				{/snippet}
			</Doughnut>

			<div class="coverage__facts">
				<p class="coverage__count">
					<strong>{coverage.quiet}</strong> z {coverage.elapsed}
					{plural(coverage.elapsed, DAYS)}
				</p>

				{#if streak}
					<p class="coverage__streak" class:coverage__streak--none={streak.days === 0}>
						{streakLine(streak.days)}
					</p>
				{/if}

				{#if coverage.spending > 0}
					<p class="coverage__gaps">
						{coverage.spending}
						{plural(coverage.spending, DAYS)} se něco utratilo. Den, na který jsi zapomněl, se dá doplnit
						ve výpisu kdykoliv potom.
					</p>
				{:else if coverage.elapsed > 0}
					<p class="coverage__gaps">Tenhle měsíc zatím neodešla ani koruna.</p>
				{/if}
			</div>
		</div>
	</section>

	<!-- One copy of the vysvětlivka, rendered under whichever verdict shows. -->
	{#snippet kontrolaLabel()}
		<Explainer term="Kontrola">
			<p>
				App ti kouká přes rameno — při zápisu i nad měsícem: duplicity, záznamy bez kategorie,
				bucket, který přetéká, stará hodnota investice. Nic z toho nebrání uložení. Každý nález jen
				radí, a co jde, má opravu na jedno ťuknutí.
			</p>
		</Explainer>
	{/snippet}

	{#if findings.length > 0}
		<section class="card">
			<h2 class="u-label">{@render kontrolaLabel()}</h2>
			<ul class="findings">
				{#each findings as finding (finding.id)}
					<li class="finding">
						<span class="finding__dot" data-severity={finding.severity}></span>
						<div class="finding__text">
							<p class="finding__title">{finding.title}</p>
							<p class="finding__detail">{finding.detail}</p>
							<!--
							  The only finding here that can be acted on from this screen.
							  Everything else on the list is about rows already written, and
							  the place to fix those is the tape.
							-->
							{#if finding.fix?.kind === 'value-holding'}
								<a class="finding__fix" href={resolve('/jmeni')}>{finding.fix.label}</a>
							{:else if finding.fix?.kind === 'drain-bucket'}
								{@const fix = finding.fix}
								<button
									type="button"
									class="finding__fix"
									onclick={() => (draining = fix.categoryId)}
								>
									{fix.label}
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{:else if summary.outflow !== ZERO}
		<section class="card">
			<h2 class="u-label">{@render kontrolaLabel()}</h2>
			<p class="ok">
				<span class="ok__tick"><Icon name="check" size={14} stroke={2.6} /></span>
				Nic k vytknutí. Měsíc sedí.
			</p>
		</section>
	{/if}

	{#if receivables.length > 0}
		<section class="card">
			<h2 class="u-label">Dluží mi</h2>
			<div class="owed-total">
				<span>Celkem venku</span>
				<Money value={owed} size="lg" bold colour={false} />
			</div>
			<ul class="owed-list">
				{#each receivables as receivable (receivable.txn.id)}
					<li class="owed-row">
						<div class="owed-row__what">
							<span class="owed-row__who">{receivable.who}</span>
							<span class="owed-row__for">
								{receivable.txn.payee || 'bez popisu'} · z {formatMoney(receivable.spent)}
							</span>
						</div>
						<Money value={receivable.amount} size="base" bold colour={false} />
						<button
							type="button"
							class="owed-row__ok"
							onclick={() => markReceived(receivable.txn.id)}
						>
							Přijato
						</button>
					</li>
				{/each}
			</ul>
			<!-- The same sentence at all three moments dluží mi is on the glass:
			     here, the entry sheet, and the tape's edit sheet. -->
			<p class="hint prose">
				Zaplatil jsi celou částku, takže celá jde ze zůstatku. Tohle si jen pamatuje, kolik se má
				vrátit — až dorazí, odškrtneš to a zapíše se příjem.
			</p>
		</section>
	{/if}

	<!--
		The 10/10/10/70 split. Actual on top, because the question is "how am I
		doing"; the book's shape underneath it, because that is what the answer is
		measured against. Same four colours in both rings, so the comparison is
		made by the eye rather than by arithmetic.
	-->
	<section class="card">
		<h2 class="u-label">
			<Explainer term="Rozdělení příjmu">
				<p>
					Z každé koruny příjmu: 10 % dávání, 10 % spoření, 10 % dluhy, 70 % život. Velký kruh je
					tvůj měsíc, malý je předloha. Měří se proti příjmu, ne proti výdajům — proto může něco
					zbýt. A zbytek je taky výsledek.
				</p>
			</Explainer>
		</h2>

		{#if split.hasIncome}
			<div class="split">
				<Doughnut segments={actualSegments} size={148} title="Jak jsi rozdělil příjem">
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
						<li class="legend__row">
							<span class="legend__dot" style="background: {CLASS_COLOUR[slice.cls]}"></span>
							<span class="legend__name">
								{slice.label}
								<span class="legend__note">{CLASS_NOTE[slice.cls]}</span>
							</span>
							<span class="legend__pct">{slice.percent} %</span>
							<span
								class="legend__delta"
								data-state={slice.cls === 'live' ? 'flat' : slice.delta < 0 ? 'under' : 'over'}
							>
								{slice.delta > 0 ? '+' : ''}{slice.delta}
							</span>
						</li>
					{/each}
				</ul>
			</div>

			<p class="verdict" class:verdict--ok={!split.weakest && split.left >= 0}>
				{verdict(split)}
			</p>
		{:else}
			<p class="hint prose">{verdict(split)}</p>
		{/if}

		<hr class="perforation" />

		<div class="target">
			<Doughnut
				segments={targetSegments}
				size={84}
				thickness={16}
				track="transparent"
				title="Jak to má být: 10 / 10 / 10 / 70"
			/>
			<div class="target__text">
				<h3 class="u-label">Jak to má být</h3>
				<ul class="target__list">
					{#each targetSlices() as slice (slice.cls)}
						<li>
							<span class="legend__dot" style="background: {CLASS_COLOUR[slice.cls]}"></span>
							<strong>{slice.percent} %</strong>
							{slice.label.toLocaleLowerCase('cs')}
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</section>

	<section class="card">
		<h2 class="u-label">Kam to šlo</h2>
		{#if summary.buckets.length === 0}
			<p class="empty">Zatím žádné výdaje.</p>
		{:else}
			<ul class="buckets">
				{#each summary.buckets as bucket (bucket.category?.id ?? 'none')}
					{@const trend = trends.get(bucket.category?.id ?? null)}
					<li class="bucket">
						<div class="bucket__head">
							<span class="bucket__name" class:bucket__name--none={!bucket.category}>
								{bucket.category?.name ?? 'bez kategorie'}
							</span>
							<span class="bucket__numbers">
								<span class="bucket__share">{bucket.share} %</span>
								<Money value={bucket.total} size="base" bold />
							</span>
						</div>
						<div class="meter">
							<span
								class="meter__fill"
								data-type={bucket.category?.spendType ?? 'none'}
								style="width: {barWidth(bucket.total)}%"
							></span>
						</div>
						<div class="bucket__foot">
							<span class="bucket__count">{bucket.count}×</span>

							<!--
							  Against its own normal, not against the other buckets. The
							  biggest bucket is the rent every month, and saying so is worth
							  nothing; what is worth something is that this month's JÍDLO is
							  a third dearer than JÍDLO usually is.

							  Silent when the move is small, and silent when there is no
							  history — a percentage off one month is not a trend.
							-->
							{#if trend && trend.direction !== 'flat' && trend.changePercent !== null}
								<span class="bucket__trend" data-direction={trend.direction}>
									{trend.direction === 'up' ? '↑' : '↓'}
									{Math.abs(trend.changePercent)} % oproti obvyklým
									{formatMoney(trend.typical!, { sign: 'never' })}
								</span>
							{:else if bucket.oneOffTotal !== 0}
								<span class="bucket__oneoff">
									z toho 1× {formatMoney(bucket.oneOffTotal, { sign: 'never' })}
								</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<RefileSheet
	open={draining !== null}
	bucket={drainBucket}
	candidates={drainCandidates}
	categories={($categories ?? []) as Category[]}
	onrefile={refile}
	onclose={() => (draining = null)}
/>

<TabBar />

<style>
	/* ── the month switcher ──────────────────────────────────────────────── */

	.switcher {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex: 1;
		margin-inline: calc(var(--space-2) * -1);
	}

	.switcher h1 {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-tight);
		text-align: center;
	}

	.switcher__step {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--touch);
		height: var(--touch);
		border-radius: var(--radius-full);
		color: var(--ink-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out);
	}

	.switcher__step:disabled {
		opacity: 0.22;
		cursor: default;
	}

	.switcher__step:not(:disabled):active {
		background: var(--surface-2);
		color: var(--ink);
	}

	@media (hover: hover) {
		.switcher__step:not(:disabled):hover {
			background: var(--surface-2);
			color: var(--ink);
		}
	}

	/* ── page ────────────────────────────────────────────────────────────── */

	.page {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-5);
	}

	.aside {
		font-size: var(--text-xs);
		color: var(--ink-2);
		padding-inline: var(--space-2);
	}

	.aside strong {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--ink);
	}

	/* The card itself is `app.css`. This screen packs more into one than the
	   others do, so it takes a tighter gap and nothing else. */
	.card {
		gap: var(--space-3);
	}

	.card__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.card__go {
		display: grid;
		place-items: center;
		color: var(--ink-3);
		transition: transform var(--dur-base) var(--ease-out);
	}

	/* ── goal ────────────────────────────────────────────────────────────── */

	.card--goal {
		gap: var(--space-2);
		text-decoration: none;
		color: inherit;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.card--goal:active {
		transform: scale(0.995);
	}

	@media (hover: hover) {
		.card--goal:hover {
			border-color: var(--hairline-2);
		}

		.card--goal:hover .card__go {
			transform: translateX(2px);
			color: var(--ink-2);
		}
	}

	/* The why is the goal, so it is set as a voice rather than as a field. */
	.goal__why {
		font-size: var(--text-md);
		font-style: italic;
		line-height: var(--leading-base);
		color: var(--ink-2);
		text-wrap: pretty;
	}

	.goal__numbers {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-top: var(--space-1);
	}

	.goal__of {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.goal__pace {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.goal__pace[data-pace='behind'] {
		color: var(--flag);
	}

	.goal__pace[data-pace='done'] {
		color: var(--in);
	}

	/* ── the shared meter ────────────────────────────────────────────────
	   Geometry, track and default fill live in `app.css`, because `/cil` draws
	   the same bar and a length has to mean the same thing on both screens.
	   What is local is what the colour *means* here: pace against the month. */

	.meter__fill[data-pace='on'] {
		background: var(--signal);
	}

	.meter__fill[data-pace='done'] {
		background: var(--in);
	}

	.meter__fill[data-pace='behind'] {
		background: var(--flag);
	}

	.meter__fill[data-type='want'] {
		background: var(--flag);
	}

	.meter__fill[data-type='give'] {
		background: var(--split-give);
	}

	.meter__fill[data-type='debt'] {
		background: var(--split-debt);
	}

	.meter__fill[data-type='save'] {
		background: var(--in);
	}

	.meter__fill[data-type='none'] {
		background: var(--danger);
	}

	/* ── coverage ─────────────────────────────────────────────────────────── */

	.coverage__body {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	/* `nowrap` is load-bearing: at 100 % the space before the sign is the only
	   break opportunity in the hole, and without this the ring reads "100" over
	   "%" on two lines. */
	.coverage__percent {
		font-family: var(--font-mono);
		font-size: var(--text-lg);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: var(--track-tight);
		white-space: nowrap;
		color: var(--ink);
	}

	.coverage__facts {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.coverage__count {
		font-size: var(--text-base);
		color: var(--ink-2);
	}

	.coverage__count strong {
		font-family: var(--font-mono);
		font-size: var(--text-lg);
		color: var(--ink);
	}

	/* Mint, not signal: a run of days that cost nothing is a money verdict that
	   came out right, and a statistic must not wear the tap-me colour. A broken
	   run is not a failure and does not get the flag — spending money is what
	   money is for, and an alarm every time somebody buys lunch is a line
	   nobody reads. */
	.coverage__streak {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--in);
	}

	.coverage__streak--none {
		font-weight: 400;
		color: var(--ink-3);
	}

	.coverage__gaps {
		font-size: var(--text-xs);
		line-height: var(--leading-base);
		color: var(--ink-3);
		text-wrap: pretty;
	}

	/* ── findings ────────────────────────────────────────────────────────
	   Same vocabulary as the live checks on the entry screen: a tone dot, a
	   title, a detail. Two screens, one grammar. */

	.findings {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.finding {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.finding__dot {
		flex: none;
		width: 6px;
		height: 6px;
		margin-top: 7px;
		border-radius: var(--radius-full);
		background: var(--ink-3);
	}

	.finding__dot[data-severity='warn'] {
		background: var(--flag);
	}

	.finding__text {
		flex: 1;
		min-width: 0;
	}

	.finding__title {
		font-size: var(--text-md);
		font-weight: 600;
	}

	.finding__detail {
		font-size: var(--text-xs);
		color: var(--ink-2);
		line-height: var(--leading-base);
		text-wrap: pretty;
	}

	/* Drawn small and hit big: the ::after pushes the target back out to a thumb
	   without the link itself taking a row's worth of height. */
	.finding__fix {
		position: relative;
		display: inline-block;
		align-self: flex-start;
		padding: 0;
		border: none;
		background: none;
		margin-block-start: var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--signal);
		text-decoration: none;
	}

	.finding__fix::after {
		content: '';
		position: absolute;
		inset: calc((var(--touch) - 1lh) / -2) calc(var(--space-2) * -1);
	}

	@media (hover: hover) {
		.finding__fix:hover {
			text-decoration: underline;
		}
	}

	.ok {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-md);
		color: var(--in);
	}

	.ok__tick {
		display: grid;
		place-items: center;
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--in-wash);
	}

	/* ── receivables ─────────────────────────────────────────────────────── */

	.owed-total {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--ink-2);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--hairline);
	}

	.owed-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.owed-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.owed-row__what {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.owed-row__who {
		font-size: var(--text-md);
	}

	.owed-row__for {
		font-size: var(--text-xs);
		color: var(--ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.owed-row__ok {
		flex: none;
		min-height: var(--touch);
		padding-inline: var(--space-3);
		border: 1px solid color-mix(in srgb, var(--in) 50%, var(--hairline));
		border-radius: var(--radius-sm);
		background: var(--in-wash);
		color: var(--in);
		font-size: var(--text-2xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		transition: transform var(--dur-press) var(--ease-out);
	}

	.owed-row__ok:active {
		transform: scale(0.96);
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	/* ── the 10/10/10/70 split ───────────────────────────────────────────── */

	.split {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.split__big {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-tight);
	}

	.split__big--over {
		color: var(--danger);
	}

	.split__small {
		font-size: var(--text-2xs);
		color: var(--ink-3);
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-width: 11rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.legend__row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.legend__dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		align-self: center;
	}

	.legend__name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		font-size: var(--text-md);
		line-height: 1.25;
	}

	.legend__note {
		font-size: var(--text-2xs);
		color: var(--ink-3);
	}

	.legend__pct {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-md);
		font-weight: 600;
	}

	/* The delta is the number that says what to do. It gets the only colour. */
	.legend__delta {
		flex: none;
		width: 2.25rem;
		text-align: right;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.legend__delta[data-state='under'] {
		color: var(--flag);
	}

	.legend__delta[data-state='over'] {
		color: var(--in);
	}

	.verdict {
		font-size: var(--text-md);
		line-height: var(--leading-base);
		color: var(--flag);
		text-wrap: pretty;
	}

	.verdict--ok {
		color: var(--in);
	}

	.target {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.target__text h3 {
		margin-bottom: var(--space-2);
	}

	.target__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.target__list li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.target__list strong {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	/* ── buckets ─────────────────────────────────────────────────────────── */

	.buckets {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.bucket__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.bucket__name {
		font-size: var(--text-md);
	}

	.bucket__name--none {
		color: var(--flag);
	}

	.bucket__numbers {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
	}

	.bucket__share {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.bucket__foot {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.bucket__count {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.bucket__oneoff {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	/* Amber for dearer than usual, and the ink for cheaper — never the signal
	   green. Spending less is not an achievement the app gets to celebrate; it
	   is a fact, and the flag colour is reserved for "look at this". */
	.bucket__trend {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}

	.bucket__trend[data-direction='up'] {
		color: var(--flag);
	}

	.empty {
		font-size: var(--text-md);
		color: var(--ink-3);
	}
</style>
