<script lang="ts">
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { settleReceivable, unsettleReceivable } from '$lib/db/repo';
	import { summariseMonth } from '$lib/domain/checks';
	import { formatMonthHeading, monthKey, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, type Minor } from '$lib/domain/money';
	import { openReceivables, totalOwed } from '$lib/domain/receivables';
	import { goalStatus, paceText, pickPrimary } from '$lib/domain/goals';
	import {
		CLASS_NOTE,
		prosperitySplit,
		targetSlices,
		verdict,
		type ProsperityClass
	} from '$lib/domain/prosperity';
	import type { Category, Goal, MonthTarget, Txn } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Doughnut, { type Segment } from '$lib/ui/Doughnut.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Money from '$lib/ui/Money.svelte';
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
	<title>Výdaje — měsíc</title>
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
				{#if !goal.isCommitted}
					<span class="badge badge--flag">nepotvrzeno</span>
				{/if}
			</div>

			<div class="meter meter--thick">
				<span class="meter__fill" data-pace={goal.pace} style="width: {goal.monthPercent}%"></span>
			</div>

			<p class="goal__pace" data-pace={goal.pace}>{paceText(goal)}</p>
		</a>
	{/if}

	{#if summary.findings.length > 0}
		<section class="card">
			<h2 class="u-label">Kontrola</h2>
			<ul class="findings">
				{#each summary.findings as finding (finding.id)}
					<li class="finding">
						<span class="finding__dot" data-severity={finding.severity}></span>
						<div class="finding__text">
							<p class="finding__title">{finding.title}</p>
							<p class="finding__detail">{finding.detail}</p>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{:else if summary.outflow !== ZERO}
		<section class="card">
			<h2 class="u-label">Kontrola</h2>
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
			<p class="hint prose">
				Tyhle peníze nejsou v zůstatku — zaplatil jsi celou částku. Až dorazí, přibude příjem.
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
		<h2 class="u-label">Rozdělení příjmu</h2>

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
							{#if bucket.oneOffTotal !== 0}
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

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		box-shadow: var(--edge), var(--elev-1);
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

	.badge {
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: 600;
		line-height: 1.5;
	}

	.badge--flag {
		background: var(--flag-wash);
		color: var(--flag);
	}

	/* ── the shared meter ────────────────────────────────────────────────
	   One bar, used by the goal and by every bucket, so a length means the
	   same thing wherever it appears on the screen. */

	.meter {
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--surface-3);
		overflow: hidden;
	}

	.meter--thick {
		height: 6px;
	}

	.meter__fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-full);
		background: var(--ink-2);
		/* Width, not `scaleX`: these are pill-shaped, and scaling one horizontally
		   squashes the radius on its end into an ellipse. They animate once, when
		   the figures load or change, so there is no layout cost worth the
		   distortion. */
		transition: width var(--dur-slow) var(--ease-out);
	}

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
		font-weight: 500;
	}

	.finding__detail {
		font-size: var(--text-xs);
		color: var(--ink-2);
		line-height: var(--leading-base);
		text-wrap: pretty;
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

	.empty {
		font-size: var(--text-md);
		color: var(--ink-3);
	}
</style>
