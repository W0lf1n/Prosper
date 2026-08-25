<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import {
		clearZeroSpendDay,
		deleteTxn,
		markZeroSpendDay,
		restoreTxn,
		updateTxn
	} from '$lib/db/repo';
	import { formatDayHeading, formatMonthHeading, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, neg, parseAmount, type Minor } from '$lib/domain/money';
	import { buildTape } from '$lib/domain/ledger';
	import { isOpenReceivable } from '$lib/domain/receivables';
	import type { Category, Txn } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Money from '$lib/ui/Money.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const account = liveQuery(async () =>
		data.accountId ? ((await db().accounts.get(data.accountId)) ?? null) : null
	);

	const txns = liveQuery(async () =>
		data.accountId
			? (await db().txns.where('accountId').equals(data.accountId).toArray()).filter(
					(t) => !t.isDeleted
				)
			: []
	);

	const categories = liveQuery(() => db().categories.toArray());
	const dayMarks = liveQuery(() => db().dayMarks.toArray());

	const categoryById = $derived(new Map(($categories ?? []).map((c: Category) => [c.id, c])));

	const months = $derived(
		$account
			? buildTape($txns ?? [], {
					openingBalance: $account.openingBalance,
					dayMarks: ($dayMarks ?? []).map((m) => m.date),
					today: today()
				})
			: []
	);

	const balance = $derived(months[0]?.days[0]?.balance ?? $account?.openingBalance ?? ZERO);

	// ── edit sheet ──────────────────────────────────────────────────────────
	let editing = $state<Txn | null>(null);
	let editAmount = $state('');
	let editDate = $state('');
	let editCategory = $state('');
	let editPayee = $state('');
	let editNote = $state('');
	let editError = $state('');

	function openEdit(txn: Txn) {
		editing = txn;
		editAmount = formatMoney(txn.amount, { currency: false, sign: 'never' });
		editDate = txn.date;
		editCategory = txn.categoryId ?? '';
		editPayee = txn.payee;
		editNote = txn.note ?? '';
		editError = '';
	}

	async function saveEdit() {
		if (!editing) return;

		const parsed = parseAmount(editAmount);
		if (!parsed.ok) {
			editError =
				parsed.error === 'too-many-decimals' ? 'Nejvýš dvě desetinná místa.' : 'Tohle není částka.';
			return;
		}
		if (parsed.value === 0) {
			editError = 'Nulová částka nedává smysl.';
			return;
		}

		// The sign belongs to the original direction, not to what was typed.
		const magnitude = Math.abs(parsed.value) as Minor;
		const amount = editing.amount < 0 ? neg(magnitude) : magnitude;

		await updateTxn(editing.id, {
			amount,
			date: editDate,
			categoryId: editCategory || null,
			payee: editPayee,
			note: editNote
		});
		editing = null;
	}

	async function removeTxn() {
		if (!editing) return;
		const doomed = editing;
		editing = null;
		await deleteTxn(doomed.id);
		toast.show('Záznam smazán', { undo: () => restoreTxn(doomed.id) });
	}

	async function toggleDayMark(date: string, marked: boolean) {
		if (marked) await clearZeroSpendDay(date);
		else await markZeroSpendDay(date);
	}
</script>

<svelte:head>
	<title>Výdaje — výpis</title>
</svelte:head>

<AppBar title="Výpis" />

<section class="balance">
	<h2 class="balance__name u-label">{$account?.name ?? '—'}</h2>
	<Money value={balance} colour={false} size="2xl" bold />
	<span class="balance__caption">aktuální zůstatek</span>
</section>

<main class="tape">
	{#each months as month (month.key)}
		<section class="month">
			<header class="month__head">
				<h2 class="u-label">{formatMonthHeading(month.firstDate)}</h2>
				<div class="month__totals">
					<span class="month__leg">
						<Icon name="arrow-down" size={11} stroke={2.4} />
						<Money value={month.outflow} size="sm" colour={false} sign="never" currency={false} />
					</span>
					<span class="month__leg month__leg--in">
						<Icon name="arrow-up" size={11} stroke={2.4} />
						<Money value={month.inflow} size="sm" colour={false} currency={false} />
					</span>
				</div>
			</header>

			{#each month.days as day (day.date)}
				<div class="day" class:day--gap={day.isGap}>
					<div class="day__head">
						<span class="day__date">{formatDayHeading(day.date)}</span>
						{#if day.rows.length > 0}
							<Money value={day.net} size="sm" colour={false} />
						{/if}
					</div>

					{#if day.rows.length === 0}
						<button
							type="button"
							class="blank"
							class:blank--marked={day.hasDayMark}
							onclick={() => toggleDayMark(day.date, day.hasDayMark)}
						>
							{#if day.hasDayMark}
								<span class="blank__tick"><Icon name="check" size={15} stroke={2.4} /></span>
								<span class="blank__mark">bez výdaje</span>
							{:else}
								<span class="blank__gap">žádný záznam</span>
								<span class="blank__hint">označit jako den bez výdaje</span>
							{/if}
						</button>
					{:else}
						<ul class="rows">
							{#each day.rows as row (row.txn.id)}
								<li>
									<button type="button" class="row" onclick={() => openEdit(row.txn)}>
										<span class="row__label">
											<span class="row__category" class:row__category--none={!row.txn.categoryId}>
												{categoryById.get(row.txn.categoryId ?? '')?.name ?? 'bez kategorie'}
											</span>
											{#if row.txn.payee || isOpenReceivable(row.txn)}
												<span class="row__payee">
													{row.txn.payee}
													{#if isOpenReceivable(row.txn)}
														<span class="row__owed">
															· {row.txn.owedBy || 'někdo'} dluží {formatMoney(
																row.txn.owedAmount!,
																{
																	currency: false
																}
															)}
														</span>
													{/if}
												</span>
											{/if}
										</span>
										<span class="row__amounts">
											<Money value={row.txn.amount} size="base" bold />
											<Money value={row.balance} size="sm" colour={false} currency={false} />
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					<hr class="perforation day__rule" />
				</div>
			{/each}
		</section>
	{/each}
</main>

<TabBar />

<Sheet open={editing !== null} title="Upravit záznam" onclose={() => (editing = null)}>
	<div class="form">
		<label class="field">
			<span class="field__label">Částka</span>
			<input class="field__input field__input--mono" bind:value={editAmount} inputmode="decimal" />
		</label>

		<label class="field">
			<span class="field__label">Datum</span>
			<input class="field__input field__input--mono" type="date" bind:value={editDate} />
		</label>

		<label class="field">
			<span class="field__label">Kategorie</span>
			<select class="field__input" bind:value={editCategory}>
				<!-- Only offered when the row already is one, so it can be fixed. -->
				{#if editing?.categoryId === null}
					<option value="">bez kategorie</option>
				{/if}
				{#each ($categories ?? []).filter((c: Category) => !c.isArchived && !c.isDeleted) as category (category.id)}
					<option value={category.id}>{category.name}</option>
				{/each}
			</select>
		</label>

		<label class="field">
			<span class="field__label">Komu / za co</span>
			<input class="field__input" bind:value={editPayee} />
		</label>

		<label class="field">
			<span class="field__label">Poznámka</span>
			<input class="field__input" bind:value={editNote} />
		</label>

		{#if editError}
			<p class="error-text">{editError}</p>
		{/if}

		<div class="form__actions">
			<button type="button" class="btn btn--danger" onclick={removeTxn}>Smazat</button>
			<button type="button" class="btn btn--primary" onclick={saveEdit}>Uložit</button>
		</div>
	</div>
</Sheet>

<style>
	/* The one number this screen exists to answer. It gets a slab of its own. */
	.balance {
		flex: none;
		display: flex;
		flex-direction: column;
		margin: 0 var(--space-3) var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		box-shadow: var(--edge), var(--elev-1);
	}

	.balance__name {
		margin-bottom: var(--space-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.balance__caption {
		font-size: var(--text-2xs);
		color: var(--ink-3);
	}

	/**
	 * Short screens: the slab is `flex: none`, so its padding is height the tape
	 * below it does not get. On a landscape phone the balance closes up rather
	 * than squeezing the list into a letterbox.
	 */
	@media (max-height: 560px) {
		.balance {
			margin-bottom: var(--space-2);
			padding: var(--space-2) var(--space-4) var(--space-3);
		}

		.balance__name {
			margin-bottom: var(--space-1);
		}
	}

	.tape {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: 0 var(--space-3) var(--space-5);
	}

	.month {
		/**
		 * `flex: none` is load-bearing, not tidiness.
		 *
		 * `.tape` is a flex column, so a month is a flex item and shrinks by
		 * default. `overflow: hidden` — here only to clip the corner radius —
		 * drops the item's automatic minimum size to zero, which means a month
		 * asking for 1 800 px was being squashed into 400 and the rest silently
		 * clipped. The tape had nothing left to scroll.
		 */
		flex: none;
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		box-shadow: var(--edge), var(--elev-1);
		overflow: hidden;
	}

	.month__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--hairline);
		background: var(--surface-2);
	}

	.month__totals {
		display: flex;
		gap: var(--space-4);
	}

	.month__leg {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--ink-2);
	}

	.month__leg--in {
		color: var(--in);
	}

	.day__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-1);
	}

	.day__date {
		font-size: var(--text-2xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.day__rule {
		margin-inline: var(--space-4);
	}

	.day:last-child .day__rule {
		display: none;
	}

	/**
	 * A day with nothing in it is a hole in the ledger, not an absence — so it
	 * is drawn as a hole: the surface is pressed in rather than raised, and the
	 * light that lands on every other row does not land here.
	 */
	.day--gap {
		background: var(--surface-2);
		box-shadow: inset 0 1px 3px rgb(0 0 0 / 12%);
	}

	.day--gap .day__date {
		opacity: 0.72;
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--touch);
		padding: var(--space-2) var(--space-4);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.row:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.row:hover {
			background: var(--surface-2);
		}
	}

	.row__label {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.row__category {
		font-size: var(--text-md);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row__category--none {
		color: var(--flag);
	}

	.row__payee {
		font-size: var(--text-xs);
		color: var(--ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row__owed {
		color: var(--flag);
	}

	.row__amounts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		flex: none;
	}

	/* The running balance is context, not the number being read. */
	.row__amounts :global(.money:last-child) {
		color: var(--ink-3);
	}

	.blank {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--touch);
		padding: 0 var(--space-4);
		text-align: left;
		font-size: var(--text-md);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.blank:active {
		background: var(--surface-3);
	}

	@media (hover: hover) {
		.blank:hover {
			background: var(--surface-3);
		}
	}

	.blank__gap {
		color: var(--ink-3);
	}

	.blank__tick {
		display: grid;
		place-items: center;
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--in-wash);
		color: var(--in);
	}

	.blank__mark {
		flex: 1;
		color: var(--ink-2);
	}

	.blank__hint {
		font-size: var(--text-2xs);
		color: var(--ink-3);
		opacity: 0.78;
		text-align: right;
	}

	/* ── edit form ───────────────────────────────────────────────────────── */

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form__actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.form__actions .btn {
		flex: 1;
	}
</style>
