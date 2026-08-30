<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import {
		deleteTxn,
		getCollapsedMonths,
		reconcileAccount,
		restoreTxn,
		setCollapsedMonths,
		settleReceivable,
		unsettleReceivable,
		updateTxn
	} from '$lib/db/repo';
	import { formatDayHeading, formatMonthHeading, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, neg, parseAmount, type Minor } from '$lib/domain/money';
	import { buildTape } from '$lib/domain/ledger';
	import { MAX_SHARES, isOpenReceivable, isOpenShare, sharesOf } from '$lib/domain/receivables';
	import { daysSinceReconciled } from '$lib/domain/reconcile';
	import { uuidv7 } from '$lib/domain/ids';
	import { DAYS, counted } from '$lib/domain/czech';
	import type { Category, Reconciliation, Txn, TxnShare } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Money from '$lib/ui/Money.svelte';
	import ReconcileSheet from '$lib/ui/ReconcileSheet.svelte';
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

	const categoryById = $derived(new Map(($categories ?? []).map((c: Category) => [c.id, c])));

	const months = $derived(
		$account
			? buildTape($txns ?? [], { openingBalance: $account.openingBalance, today: today() })
			: []
	);

	const balance = $derived(months[0]?.days[0]?.balance ?? $account?.openingBalance ?? ZERO);

	// ── folded months ───────────────────────────────────────────────────────
	//
	// Eight months of real entries is a scroll measured in screens, and most of
	// the time only one of them is being read. A month folds to its own header,
	// which already carries the two figures that answer "do I need to open
	// this" — in and out — so the fold costs no information.
	//
	// The set is remembered in `meta` (`repo.ts`), because a fold that resets
	// every time the app is opened is worse than no fold at all: the one thing
	// this is for is not having to scroll past 2026-01 again tomorrow.
	//
	// `null` means the preference has not been read yet, and the tape waits for
	// it. That is not caution about a slow read — it is one IndexedDB round trip
	// on a screen already waiting for the ledger itself — it is to avoid every
	// month rendering open and then snapping shut a frame later.
	// A list rather than a `Set`: it is the shape `meta` stores, there are never
	// more than a couple of dozen of them, and `$state` sees a reassignment
	// where it does not see `Set.add`.
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

	const sinceReconciled = $derived(
		data.accountId
			? daysSinceReconciled(($reconciliations ?? []) as Reconciliation[], data.accountId, today())
			: null
	);

	/**
	 * The balance handed to the sheet, captured *before* anything is written.
	 *
	 * A figure read after the adjustment lands already contains it, and the
	 * reconciliation would then record a delta of zero against a balance that
	 * never existed — the row would be right and the record of why would be a
	 * lie.
	 */
	const computedBalance = $derived(balance);

	/** Income buckets included: a difference can be money that arrived. */
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
				? `Vyrovnáno o ${formatMoney(result.adjustment.amount, { sign: 'never' })}`
				: 'Srovnáno s bankou'
		);
	}

	// ── edit sheet ──────────────────────────────────────────────────────────
	let editing = $state<Txn | null>(null);
	let editAmount = $state('');
	let editDate = $state('');
	let editCategory = $state('');
	let editPayee = $state('');
	let editNote = $state('');
	let editError = $state('');

	/**
	 * Dluží mi, on the row it came out of.
	 *
	 * `/mesic` has had the one-tap **Přijato** since P1, and it is the right
	 * place for the list of everything outstanding. It was the *only* place, and
	 * that was the bug: the row is what you tap when you remember Honza paid you
	 * back, because the row is where the app shows you he owes. Opening it and
	 * finding no way to say so — and no way to fix a share typed wrong, which
	 * could until now only ever be set once, at entry — is the screen refusing
	 * to talk about the thing it just brought up.
	 *
	 * Since Q47 the row carries a *list* of shares, one per person, each with
	 * its own Přijato — Friend1 paying up says nothing about Friend2. This is
	 * also the only place a second person is added to an already-saved row.
	 */
	interface EditShare {
		/** Null until saved — a person added in this sheet. */
		id: string | null;
		amount: string;
		who: string;
		/** The saved settlement. A settled share renders read-only. */
		settledByTxnId: string | null;
	}
	let editShares = $state<EditShare[]>([]);

	/** The shares as the row holds them — Přijato settles these, not the drafts. */
	const storedShares = $derived(
		new Map<string, TxnShare>(editing ? sharesOf(editing).map((s) => [s.id, s]) : [])
	);

	const canAddShare = $derived.by(() => {
		// Settled shares count against the ceiling too — they are still people
		// on this payment, not free slots.
		if (editShares.length >= MAX_SHARES) return false;
		const editable = editShares.filter((row) => row.settledByTxnId === null);
		return editable.length === 0 || editable[editable.length - 1]!.amount.trim() !== '';
	});

	function openEdit(txn: Txn) {
		editing = txn;
		editAmount = formatMoney(txn.amount, { currency: false, sign: 'never' });
		editDate = txn.date;
		editCategory = txn.categoryId ?? '';
		editPayee = txn.payee;
		editNote = txn.note ?? '';
		editShares = sharesOf(txn).map((share) => ({
			id: share.id,
			amount: formatMoney(share.amount, { currency: false, sign: 'never' }),
			who: share.who,
			settledByTxnId: share.settledByTxnId
		}));
		// Nothing open to type into — offer one empty pair, like the entry sheet.
		if (txn.amount < 0 && editShares.every((row) => row.settledByTxnId !== null)) {
			editShares = [...editShares, { id: null, amount: '', who: '', settledByTxnId: null }];
		}
		editError = '';
	}

	/**
	 * The money arrived — one share of it. Captured before the write, because
	 * the toast reads a figure the live query is about to change underneath it.
	 */
	async function receive(shareId: string) {
		if (!editing) return;
		const txnId = editing.id;
		editing = null;
		const repayment = await settleReceivable(txnId, shareId);
		if (!repayment) return;
		toast.money(repayment.amount, {
			message: repayment.payee,
			undo: () => unsettleReceivable(txnId, shareId)
		});
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

		// An outflow only. A share of money that came *in* is not a receivable,
		// and the entry screen does not offer it either. Settled shares pass
		// through untouched — their money already arrived; the open drafts are
		// parsed, and an emptied row is a person taken off.
		const shares: TxnShare[] = [];
		if (amount < 0) {
			let total = 0;
			for (const row of editShares) {
				if (row.settledByTxnId !== null && row.id !== null) {
					const saved = storedShares.get(row.id);
					if (saved) {
						shares.push(saved);
						total += saved.amount;
					}
					continue;
				}
				if (!row.amount.trim()) continue;
				const share = parseAmount(row.amount);
				if (!share.ok || share.value <= 0) {
					editError = 'Dlužná částka není částka.';
					return;
				}
				total += share.value;
				shares.push({
					id: row.id ?? uuidv7(),
					who: row.who,
					amount: share.value,
					settledByTxnId: null
				});
			}
			if (total > magnitude) {
				editError = 'Vrátit ti nemůže víc, než kolik to stálo.';
				return;
			}
		}

		await updateTxn(editing.id, {
			amount,
			date: editDate,
			categoryId: editCategory || null,
			payee: editPayee,
			note: editNote,
			shares
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

	/** "Zůza dluží 125,00" / "Zůza a Kerhy dluží 250,00" — the open shares, on the row. */
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
</script>

<svelte:head>
	<title>Prosper — výpis</title>
</svelte:head>

<AppBar title="Výpis" />

<!--
  The balance, and the one thing you can do to it: check it against the bank.

  The reconcile action lives here rather than in Settings because this is where
  the number being checked is printed. Sending somebody to a settings screen to
  verify a figure they are currently looking at is how a monthly habit becomes a
  yearly one.
-->
<section class="balance slab">
	<h2 class="balance__name u-label">{$account?.name ?? '—'}</h2>
	<Money value={balance} colour={false} size="2xl" bold />
	<span class="balance__caption">aktuální zůstatek</span>

	<button type="button" class="balance__check" onclick={() => (reconciling = true)}>
		<span class="balance__check-label">Srovnat s bankou</span>
		<span class="balance__check-age">
			{#if sinceReconciled === null}
				zatím nikdy
			{:else if sinceReconciled === 0}
				dnes
			{:else}
				před {counted(sinceReconciled, DAYS)}
			{/if}
		</span>
	</button>
</section>

<ReconcileSheet
	open={reconciling}
	computed={computedBalance}
	accountName={$account?.name ?? 'Účet'}
	categories={reconcileCategories}
	onsave={saveReconciliation}
	onclose={() => (reconciling = false)}
/>

<main class="tape">
	{#each collapsed ? months : [] as month (month.key)}
		{@const open = !collapsed?.includes(month.key)}
		<section class="month slab" class:month--shut={!open}>
			<h2 class="month__title">
				<button
					type="button"
					class="month__head"
					aria-expanded={open}
					onclick={() => toggleMonth(month.key)}
				>
					<span class="month__name u-label">{formatMonthHeading(month.firstDate)}</span>
					<span class="month__totals">
						<span class="month__leg">
							<Icon name="arrow-down" size={11} stroke={2.4} />
							<Money value={month.outflow} size="sm" colour={false} sign="never" currency={false} />
						</span>
						<span class="month__leg month__leg--in">
							<Icon name="arrow-up" size={11} stroke={2.4} />
							<Money value={month.inflow} size="sm" colour={false} currency={false} />
						</span>
					</span>
					<span class="month__caret" aria-hidden="true">
						<Icon name="chevron-down" size={16} stroke={2} />
					</span>
				</button>
			</h2>

			{#each open ? month.days : [] as day (day.date)}
				<div class="day" class:day--quiet={day.rows.length === 0}>
					<div class="day__head">
						<span class="day__date">{formatDayHeading(day.date)}</span>
						{#if day.rows.length > 0}
							<Money value={day.net} size="sm" colour={false} />
						{/if}
					</div>

					{#if day.rows.length === 0}
						<!--
						  Nothing on the day, so nothing was spent on it. It used to be a
						  button — "označit jako den bez výdaje" — and the tap it asked for
						  bought nothing: forgetting to press it made a frugal Tuesday look
						  like a hole in the book. Now it is a statement, and a day that
						  turns out to have had something on it is fixed by typing the row
						  with its date, days later if need be.
						-->
						<p class="blank">
							<span class="blank__tick"><Icon name="check" size={15} stroke={2.4} /></span>
							<span class="blank__mark">bez výdaje</span>
						</p>
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
														<span class="row__owed">· {owedLine(row.txn)}</span>
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

		<!--
		  Dluží mi. Only on an outflow — a share of money that came in is not a
		  receivable — and since Q47 it is a list: one row per person, each with
		  its own Přijato, because each slice arrives on its own. Mark one
		  received, fix a figure, fix a name, add a second person, or take one
		  off the row entirely by clearing their amount.
		-->
		{#if editing && editing.amount < 0}
			<fieldset class="owed">
				<legend class="field__label">Dluží mi</legend>

				{#each editShares as row, index (row.id ?? `new-${index}`)}
					{#if row.settledByTxnId !== null}
						<p class="owed__done">
							<Icon name="check" size={15} stroke={2.4} />
							Vráceno{row.who.trim() ? ` — ${row.who}` : ''} · {row.amount}. Příjem je na výpisu.
						</p>
					{:else}
						<div class="owed__row">
							<label class="field owed__amount">
								<span class="field__label">Kolik ti vrátí</span>
								<input
									class="field__input field__input--mono"
									bind:value={row.amount}
									inputmode="decimal"
									placeholder="0"
								/>
							</label>
							<label class="field owed__who">
								<span class="field__label">Kdo</span>
								<input class="field__input" bind:value={row.who} placeholder="kdo ti to vrátí" />
							</label>
						</div>

						{#if row.id !== null && storedShares.get(row.id) && isOpenShare(storedShares.get(row.id)!)}
							<button
								type="button"
								class="btn owed__ok btn--block"
								onclick={() => receive(row.id!)}
							>
								Přijato — {formatMoney(storedShares.get(row.id)!.amount)}
							</button>
						{/if}
					{/if}
				{/each}

				{#if canAddShare}
					<button
						type="button"
						class="btn btn--quiet owed__add"
						onclick={() =>
							(editShares = [
								...editShares,
								{ id: null, amount: '', who: '', settledByTxnId: null }
							])}
					>
						Přidat dalšího
					</button>
				{/if}

				{#if editShares.some((row) => row.settledByTxnId === null && row.amount.trim())}
					<p class="field__hint">
						Zaplatil jsi celou částku, takže celá jde ze zůstatku. Tohle si jen pamatuje, kolik se
						má vrátit — až dorazí, odškrtneš to a zapíše se příjem, za každého zvlášť.
					</p>
				{:else}
					<p class="field__hint">
						Prázdné pole znamená, že ti nikdo nic nevrací. Uloží se to spolu se záznamem.
					</p>
				{/if}
			</fieldset>
		{/if}

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
	/* The slab recipe is `.slab` in `app.css`. What is local is the layout and
	   the alignment. */
	.balance {
		flex: none;
		display: flex;
		flex-direction: column;
		margin: 0 var(--space-3) var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-4);
		/* The balance is the one number this screen exists to answer, so it sits
		   under the thumb, on the right. */
		text-align: right;
	}

	/* 2xl (28) → 3xl (34). The `Money` prop stays `size="2xl"`; the slab it sits
	   in is what promotes it, so no markup moves. */
	.balance :global(.money) {
		font-size: var(--text-3xl);
		letter-spacing: var(--track-display);
	}

	/* A full-width row rather than a corner button: it carries two pieces of
	   information — the action and how long since it was last done — and the
	   second one is the reason anybody taps the first. */
	.balance__check {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--touch);
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--hairline);
		text-align: left;
	}

	.balance__check-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--signal);
	}

	.balance__check-age {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.balance__name {
		/* The account name is a left-hand label; only the figure goes right. */
		text-align: left;
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
		/* The slab recipe is `.slab` in `app.css`; this clips to its radius. */
		overflow: hidden;
	}

	/**
	 * The header is the whole control: a full-bleed row, so it presses by
	 * background luminance rather than by scale (§13.16) — `scale` on something
	 * that spans the slab reads as the slab moving.
	 *
	 * `.month__title` is the heading the outline still needs; the button inside
	 * it is what gets tapped, and it carries the padding so the target is the
	 * full width of the card.
	 */
	.month__title {
		margin: 0;
		font: inherit;
	}

	.month__head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--touch);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--hairline);
		background: var(--surface-2);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.month__head:active {
		background: var(--surface-3);
	}

	@media (hover: hover) {
		.month__head:hover {
			background: var(--surface-3);
		}
	}

	/* Shut, there is nothing under the rule for it to separate. */
	.month--shut .month__head {
		border-bottom: none;
	}

	.month__name {
		flex: 1;
		min-width: 0;
	}

	.month__totals {
		display: flex;
		gap: var(--space-4);
	}

	/* Points down at what it will open, and turns to point at what it opened. */
	.month__caret {
		display: grid;
		place-items: center;
		flex: none;
		color: var(--ink-3);
		rotate: -90deg;
		transition: rotate var(--dur-base) var(--ease-out);
	}

	.month__head[aria-expanded='true'] .month__caret {
		rotate: 0deg;
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
	 * A day with nothing on it is not a hole any more — it is an answer, and a
	 * cheap one. It keeps the recessed surface all the same, because a row with
	 * nothing to read on it should not sit at the same level as one that has
	 * five figures: `--ground-2` is darker than the card in both themes, so
	 * "pressed in" reads the same way with the lights on and off.
	 */
	.day--quiet {
		background: var(--ground-2);
	}

	.day--quiet .day__date {
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

	/* A line, not a control: there is nothing left to press here. */
	.blank {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--touch);
		padding: 0 var(--space-4);
		font-size: var(--text-md);
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

	/* ── dluží mi ────────────────────────────────────────────────────────
	   Set into the sheet rather than floating in it: this is a part of the row
	   rather than another field alongside the amount, and recessed inside a
	   surface is `--ground-2` here as everywhere. */

	.owed {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-3);
		border: none;
		border-radius: var(--radius-md);
		background: var(--ground-2);
	}

	.owed__row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 360px) {
		.owed__row {
			grid-template-columns: 1fr;
		}
	}

	.owed__amount,
	.owed__who {
		min-width: 0;
	}

	/* The one green button in the app: pressing it is money arriving, which is
	   the heart of what `--in` means. */
	.owed__ok {
		border-color: color-mix(in srgb, var(--in) 50%, var(--hairline));
		background: var(--in-wash);
		color: var(--in);
		font-weight: 600;
	}

	@media (hover: hover) {
		.owed__ok:hover {
			border-color: var(--in);
			background: var(--in-wash);
		}
	}

	.owed__done {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		line-height: var(--leading-base);
		color: var(--in);
	}

	/* Its width is its label — full-bleed here would read as the sheet's action. */
	.owed__add {
		align-self: flex-start;
	}
</style>
