<script lang="ts">
	/**
	 * Pravidelné platby — a screen of its own since 2026-08-28.
	 *
	 * It was a section inside Settings, filed under the buckets because that is
	 * where he went looking for it the first time. It outgrew that: a standing
	 * order is not a setting, it is a part of the ledger that has not happened
	 * yet, and the two questions it answers — *what does this cost me a year* and
	 * *what is waiting to be confirmed* — are asked far more often than anything
	 * else on that page.
	 *
	 * Three things live here and nowhere else:
	 *
	 * **The year, net.** Twelve subscriptions at a few hundred a month are a
	 * rounding error twelve times over; as one annual figure they are a decision.
	 * And a payment that is shared costs what stays gone, not what leaves the
	 * account (Q46) — so the summary shows the gross, what comes back, and the
	 * difference, in that order.
	 *
	 * **What arrives.** A schedule with a positive amount is money that turns up
	 * every month on its own: the other half of a shared mortgage, a rent, a
	 * standing transfer. Its own list rather than a negative row among the
	 * outgoings, because averaging the two together hides both.
	 *
	 * **What is due.** The same strip the entry screen carries. It belongs on
	 * both: there because it must not be missed, here because this is the screen
	 * somebody opens *to deal with* standing orders.
	 */
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import {
		archiveSchedule,
		confirmScheduled,
		createSchedule,
		deleteTxn,
		skipScheduled,
		updateSchedule
	} from '$lib/db/repo';
	import { formatMoney, type Minor } from '$lib/domain/money';
	import { today } from '$lib/domain/datetime';
	import { PAYMENTS, counted } from '$lib/domain/czech';
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
	import type { Category, Schedule } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import DueStrip from '$lib/ui/DueStrip.svelte';
	import Money from '$lib/ui/Money.svelte';
	import ScheduleSheet, { type ScheduleInput } from '$lib/ui/ScheduleSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { scene } from '$lib/ui/scene.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const schedules = liveQuery(() => db().schedules.orderBy('sortOrder').toArray());
	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());

	const live = $derived(
		(($schedules ?? []) as Schedule[]).filter((s) => !s.isDeleted && !s.isArchived)
	);

	const cost = $derived(recurringCost(live));
	const income = $derived(recurringIncome(live));
	const stillComing = $derived(remainingThisMonth(live, today()));

	/** `auto` rows were written by the launch catch-up; what is left is the ask. */
	const due = $derived(
		dueGroups({ schedules: live, today: today() }).filter(
			(group) => group.item.schedule.mode === 'confirm'
		)
	);

	const pickable = $derived(
		(($categories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived)
	);
	const spendingCategories = $derived(pickable.filter((c) => !c.isIncome));
	const incomeCategories = $derived(pickable.filter((c) => c.isIncome));

	function categoryName(id: string): string {
		return (($categories ?? []) as Category[]).find((c) => c.id === id)?.name ?? '—';
	}

	/** "Zůza", "Zůza a Kerhy", "Zůza, Kerhy a Pepa" — however many pay back. */
	function payerNames(schedule: Schedule): string {
		const names = scheduleSharesOf(schedule).map((s) => s.who.trim() || 'někdo');
		if (names.length <= 1) return names[0] ?? 'někdo';
		return `${names.slice(0, -1).join(', ')} a ${names[names.length - 1]}`;
	}

	// ── the sheet ───────────────────────────────────────────────────────────
	//
	// Direction is never a switch: it comes off the category, so the two add
	// buttons differ only in which buckets they offer. Editing offers the side
	// the schedule is already on — a mortgage that becomes a salary by way of a
	// dropdown is not an edit anybody meant to make.
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
		const patch = { ...input, amount: input.amount as Minor };
		if (editing) await updateSchedule(editing.id, patch);
		else await createSchedule(patch);
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

	// ── what is due ─────────────────────────────────────────────────────────
	async function confirmDue(group: DueGroup, amount: Minor | null) {
		if (!data.accountId) return;
		const txn = await confirmScheduled(group.item, {
			accountId: data.accountId,
			amount: amount ?? undefined
		});
		navigator.vibrate?.(12);
		scene.flash(txn.amount < 0 ? 'out' : 'in');
		toast.money(txn.amount, {
			message: group.item.schedule.payee,
			undo: () => deleteTxn(txn.id)
		});
	}

	async function skipDue(group: DueGroup) {
		await skipScheduled(group.item);
		toast.show(`„${group.item.schedule.payee}“ tenhle měsíc přeskočeno`);
	}
</script>

<svelte:head>
	<title>Prosper — pravidelné platby</title>
</svelte:head>

<AppBar title="Pravidelné platby" />

<main class="page">
	<DueStrip groups={due} onconfirm={confirmDue} onskip={skipDue} />

	<!--
	  The figure the whole screen exists for, and it is the year rather than the
	  month. When something is shared the month is shown as three numbers, in the
	  order the question is actually asked: this much leaves, this much comes
	  back, this is what it costs.
	-->
	<section class="card summary">
		<h2 class="u-label">Za rok</h2>
		<Money value={cost.yearly} size="2xl" bold colour={false} sign="never" />

		<dl class="facts">
			<div>
				<dt>Odejde za měsíc</dt>
				<dd class="mono">{formatMoney(cost.monthly, { sign: 'never' })}</dd>
			</div>
			{#if cost.reimbursed > 0}
				<div>
					<dt>Z toho se vrací</dt>
					<dd class="mono facts__back">{formatMoney(cost.reimbursed, { sign: 'never' })}</dd>
				</div>
				<div>
					<dt>Stojí tě to za měsíc</dt>
					<dd class="mono">{formatMoney(cost.net, { sign: 'never' })}</dd>
				</div>
			{/if}
			{#if income.rows.length > 0}
				<div>
					<dt>Přijde za měsíc</dt>
					<dd class="mono facts__in">{formatMoney(income.monthly, { sign: 'never' })}</dd>
				</div>
			{/if}
			<div>
				<dt>Ještě odejde tenhle měsíc</dt>
				<dd class="mono">{formatMoney(stillComing, { sign: 'never' })}</dd>
			</div>
		</dl>
	</section>

	<!-- ── odchází ────────────────────────────────────────────────────── -->
	<section class="card">
		<h2 class="u-label">Odchází</h2>

		{#if cost.rows.length === 0}
			<p class="hint prose">
				Nic tu zatím není. Zapiš předplatné, hypotéku nebo pojištění a app ti je každý měsíc nabídne
				sama — a hlavně spočítá, na kolik přijdou za rok.
			</p>
		{:else}
			<ul class="tiles">
				{#each cost.rows as row (row.schedule.id)}
					{@const left = remainingPayments(row.schedule, today())}
					<li>
						<button type="button" class="tile" onclick={() => openSchedule(row.schedule)}>
							<span class="tile__head">
								<span class="tile__name">{row.schedule.payee}</span>
								<span class="tile__figure">{formatMoney(row.monthly, { sign: 'never' })}</span>
							</span>

							<span class="tile__foot">
								<span class="tile__where">
									{row.schedule.dayOfMonth}. · {categoryName(row.schedule.categoryId)}
									<span class="mode" data-mode={row.schedule.mode}>
										{MODE_LABEL[row.schedule.mode]}
									</span>
								</span>

								<span class="tile__note">
									{#if left}
										zbývá {counted(left.payments, PAYMENTS)}
									{:else}
										{formatMoney(row.yearly, { sign: 'never' })} / rok
									{/if}
								</span>
							</span>

							<!--
							  The shared half, said on the row rather than only in the total:
							  a mortgage at 32 000 that costs 16 000 is two different rows to
							  read, and the list is where the comparison happens.
							-->
							{#if row.reimbursed > 0}
								<span class="tile__foot back">
									<span class="tile__where">
										vrací {payerNames(row.schedule)}
										{formatMoney(row.reimbursed, { sign: 'never' })}
									</span>
									<span class="tile__note">
										stojí {formatMoney(row.net, { sign: 'never' })}
									</span>
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="row-actions">
			<button type="button" class="btn" onclick={() => openSchedule(null, false)}>
				Přidat platbu
			</button>
		</div>

		<p class="hint prose">
			<strong>Potvrdit</strong> ti platbu v den splatnosti nabídne tady i na úvodní obrazovce.
			<strong>Automaticky</strong> ji zapíše samo při otevření app — jen pro částky, které se nemění.
		</p>
	</section>

	<!-- ── přichází ───────────────────────────────────────────────────── -->
	<section class="card">
		<h2 class="u-label">Přichází</h2>

		{#if income.rows.length === 0}
			<p class="hint prose">
				Sem patří peníze, které chodí každý měsíc samy — druhá polovina hypotéky, nájem, pravidelná
				vratka. Zapisují se stejně jako platba, jen na příjmovou kategorii.
			</p>
		{:else}
			<ul class="tiles">
				{#each income.rows as row (row.schedule.id)}
					<li>
						<button type="button" class="tile" onclick={() => openSchedule(row.schedule)}>
							<span class="tile__head">
								<span class="tile__name">{row.schedule.payee}</span>
								<span class="tile__figure tile__figure--in">
									{formatMoney(row.monthly, { sign: 'never' })}
								</span>
							</span>

							<span class="tile__foot">
								<span class="tile__where">
									{row.schedule.dayOfMonth}. · {categoryName(row.schedule.categoryId)}
									<span class="mode" data-mode={row.schedule.mode}>
										{MODE_LABEL[row.schedule.mode]}
									</span>
								</span>
								<span class="tile__note">{formatMoney(row.yearly, { sign: 'never' })} / rok</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="row-actions">
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
			<p class="hint prose">
				Nejdřív potřebuješ příjmovou kategorii — v <strong>Nastavení</strong> u kategorie zaškrtni „příjem“.
			</p>
		{/if}
	</section>

	<p class="hint hint--foot prose">
		Vrací se ti část platby? Otevři ji a vyplň <strong>Vrací se ti část</strong> — každý zapsaný měsíc
		pak čeká v přehledu měsíce k odškrtnutí, až peníze dorazí. Celá částka jde ze zůstatku, protože celou
		ji platíš ty.
	</p>
</main>

<ScheduleSheet
	open={sheetOpen}
	schedule={editing}
	categories={sheetCategories}
	onsave={saveSchedule}
	onarchive={editing ? removeSchedule : null}
	onclose={() => (sheetOpen = false)}
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

	/* Cards in a scrolling flex column never shrink: `overflow` inside one drops
	   its automatic minimum size to zero and the list gets silently clipped. */
	.page > :global(*) {
		flex: none;
	}

	.summary :global(.money) {
		letter-spacing: var(--track-display);
	}

	.facts {
		margin: 0;
		display: flex;
		flex-direction: column;
		font-size: var(--text-md);
	}

	.facts > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--touch);
		border-bottom: 1px solid var(--hairline);
	}

	.facts > div:last-child {
		border-bottom: none;
	}

	.facts dt {
		color: var(--ink-2);
	}

	.facts dd {
		margin: 0;
		color: var(--ink);
	}

	.facts__back,
	.facts__in {
		color: var(--in);
	}

	.mono {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	/* Which way it reaches the ledger, said once and quietly. `auto` takes the
	   signal because it is the one that writes without being asked. */
	.mode {
		flex: none;
		padding: 1px var(--space-2);
		border-radius: var(--radius-full);
		background: var(--surface-3);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--ink-3);
	}

	.mode[data-mode='auto'] {
		background: var(--signal-wash);
		color: var(--signal);
	}

	.hint--foot {
		padding-inline: var(--space-2);
	}

	.tile__figure--in {
		color: var(--in);
	}

	/* The second foot line: same shape, one step quieter, so the row still reads
	   as one thing rather than as two stacked. */
	.back {
		color: var(--in);
	}

	.back .tile__where,
	.back .tile__note {
		color: var(--in);
	}

	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.row-actions .btn {
		flex: 1 1 auto;
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--ink-3);
		line-height: var(--leading-base);
	}
</style>
