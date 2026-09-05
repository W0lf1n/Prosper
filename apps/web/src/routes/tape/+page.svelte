<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import {
		createTransfer,
		deleteTxn,
		getCollapsedMonths,
		reconcileAccount,
		restoreTxn,
		setCollapsedMonths,
		settleReceivable,
		unsettleReceivable,
		updateTxn,
		type Transfer
	} from '$lib/db/repo';
	import { liveAccounts, openingTotal } from '$lib/domain/accounts';
	import { DAYS, capitalize, counted } from '$lib/domain/czech';
	import { formatDayHeading, formatMonthHeading, today } from '$lib/domain/datetime';
	import { ZERO, formatMoney, neg, parseAmount, type Minor } from '$lib/domain/money';
	import { buildTape } from '$lib/domain/ledger';
	import { MAX_SHARES, isOpenReceivable, isOpenShare, sharesOf } from '$lib/domain/receivables';
	import { daysSinceReconciled } from '$lib/domain/reconcile';
	import { uuidv7 } from '$lib/domain/ids';
	import type { Account, Category, Reconciliation, Txn, TxnShare } from '$lib/domain/types';
	import Icon from '$lib/ui/Icon.svelte';
	import ReconcileSheet from '$lib/ui/ReconcileSheet.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import TransferSheet, { type TransferInput } from '$lib/ui/TransferSheet.svelte';
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
	let editing = $state<Txn | null>(null);
	let editAmount = $state('');
	let editDate = $state('');
	let editCategory = $state('');
	let editPayee = $state('');
	let editNote = $state('');
	let editError = $state('');

	interface EditShare {
		id: string | null;
		amount: string;
		who: string;
		settledByTxnId: string | null;
	}
	let editShares = $state<EditShare[]>([]);

	const storedShares = $derived(
		new Map<string, TxnShare>(editing ? sharesOf(editing).map((s) => [s.id, s]) : [])
	);

	const canAddShare = $derived.by(() => {
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
		if (txn.amount < 0 && editShares.every((row) => row.settledByTxnId !== null)) {
			editShares = [...editShares, { id: null, amount: '', who: '', settledByTxnId: null }];
		}
		editError = '';
	}

	async function receive(shareId: string) {
		if (!editing) return;
		const txnId = editing.id;
		editing = null;
		const repayment = await settleReceivable(txnId, shareId);
		if (!repayment) return;
		toast.money(repayment.amount, {
			message: repayment.payee,
			code: currency,
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

		const magnitude = Math.abs(parsed.value) as Minor;
		const amount = editing.amount < 0 ? neg(magnitude) : magnitude;

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
							<button type="button" class="row row--press" onclick={() => openEdit(row.txn)}>
								<span class="circle" style="--c: {rowColour(row.txn)}">
									<Icon name={rowIcon(row.txn)} size={18} stroke={2} />
								</span>
								<span class="row__body">
									<span class="row__title">{row.txn.payee || bucketName(row.txn)}</span>
									<span class="row__sub">
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

<Sheet open={editing !== null} title="Upravit záznam" onclose={() => (editing = null)}>
	<div class="form">
		<label class="field">
			<span class="field__label">Částka</span>
			<input class="field__input" bind:value={editAmount} inputmode="decimal" />
		</label>

		<label class="field">
			<span class="field__label">Datum</span>
			<input class="field__input" type="date" bind:value={editDate} />
		</label>

		<label class="field">
			<span class="field__label">Kategorie</span>
			<select class="field__input" bind:value={editCategory}>
				{#if editing?.categoryId === null}
					<option value="">bez kategorie</option>
				{/if}
				{#each ($categories ?? []).filter((c: Category) => !c.isArchived && !c.isDeleted) as category (category.id)}
					<option value={category.id}>{category.name}</option>
				{/each}
			</select>
		</label>

		{#if editing?.transferPairId !== null}
			<p class="field__hint">
				Tohle je jedna strana převodu mezi účty. Co odešlo, je výdaj z vybrané kategorie; co
				dorazilo, je příjem ve SMĚNA. Smazáním zmizí obě strany.
			</p>
		{/if}

		<label class="field">
			<span class="field__label">Komu / za co</span>
			<input class="field__input" bind:value={editPayee} />
		</label>

		<label class="field">
			<span class="field__label">Poznámka</span>
			<input class="field__input" bind:value={editNote} />
		</label>

		{#if editing && editing.amount < 0 && editing.transferPairId === null}
			<fieldset class="owed well">
				<legend class="field__label">Dluží mi</legend>

				{#each editShares as row, index (row.id ?? `new-${index}`)}
					{#if row.settledByTxnId !== null}
						<p class="owed__done">
							<Icon name="check" size={15} stroke={2.4} />
							Vráceno{row.who.trim() ? ` — ${row.who}` : ''} · {row.amount}. Příjem je na výpisu.
						</p>
					{:else}
						<div class="owed__row">
							<label class="field">
								<span class="field__label">Kolik ti vrátí</span>
								<input
									class="field__input owed__input"
									bind:value={row.amount}
									inputmode="decimal"
									placeholder="0"
								/>
							</label>
							<label class="field">
								<span class="field__label">Kdo</span>
								<input
									class="field__input owed__input"
									bind:value={row.who}
									placeholder="kdo ti to vrátí"
								/>
							</label>
						</div>

						{#if row.id !== null && storedShares.get(row.id) && isOpenShare(storedShares.get(row.id)!)}
							<button
								type="button"
								class="btn btn--block owed__ok"
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

		<div class="actions actions--fill">
			<button type="button" class="btn btn--danger btn--lg" onclick={removeTxn}>Smazat</button>
			<button type="button" class="btn btn--primary" onclick={saveEdit}>Uložit</button>
		</div>
	</div>
</Sheet>

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

	.row__amount--in {
		color: var(--in);
	}

	/* ── edit form ───────────────────────────────────────────────────────── */

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.owed {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		border: none;
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

	/* A field inside the well sits on the card colour, or it disappears. */
	.owed__input {
		background: var(--surface);
	}

	.owed__ok {
		background: var(--in-wash);
		color: var(--in);
	}

	.owed__done {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		line-height: var(--leading-base);
		color: var(--in);
	}

	.owed__add {
		align-self: flex-start;
	}
</style>
