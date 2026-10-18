<script lang="ts">
	/**
	 * Upravit záznam — the one editor a row has, wherever the row is printed.
	 *
	 * It lived inside `/vypis` until Domů's recent rows wanted the same tap
	 * (2026-10-18). One definition, so the two screens cannot disagree about
	 * what a row may be changed into: the amount, the day, the bucket, the
	 * hold flag and the shares somebody owes back. The caller holds an
	 * instance and calls `open(txn)`; the sheet owns everything after that,
	 * the writes and their toasts included.
	 */
	import {
		createCategory,
		deleteTxn,
		restoreTxn,
		settleReceivable,
		unsettleReceivable,
		updateTxn
	} from '$lib/db/repo';
	import { isMove } from '$lib/domain/accounts';
	import { formatMoney, neg, parseAmount, type Minor } from '$lib/domain/money';
	import { categoryRanking } from '$lib/domain/ledger';
	import { MAX_SHARES, isOpenShare, sharesOf } from '$lib/domain/receivables';
	import { uuidv7 } from '$lib/domain/ids';
	import type { Account, Category, Txn, TxnShare } from '$lib/domain/types';
	import CategoryPickerSheet from './CategoryPickerSheet.svelte';
	import type { CategoryInput } from './CategorySheet.svelte';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import { categoryStyle, colorVar } from './palette';
	import { toast } from './toast.svelte';

	interface Props {
		/** Every account — the row's own currency is read from it. */
		accounts: readonly Account[];
		/** Every bucket, archived and deleted included: the row's own is never hidden. */
		categories: readonly Category[];
		/** Live rows; the picker ranks buckets by the row's own account's use of them. */
		ledger: readonly Txn[];
	}

	let { accounts, categories, ledger }: Props = $props();

	let editing = $state<Txn | null>(null);
	let editAmount = $state('');
	let editDate = $state('');
	let editCategory = $state('');
	let editPayee = $state('');
	let editNote = $state('');
	let editProvisional = $state(false);
	let editError = $state('');
	let pickingCategory = $state(false);

	const categoryById = $derived(new Map(categories.map((c) => [c.id, c])));

	/** The row's own currency — Domů lists every account's rows together. */
	const code = $derived(accounts.find((a) => a.id === editing?.accountId)?.currency ?? 'CZK');

	/**
	 * The buckets the sheet offers: the row's direction, most-used first on
	 * its account — the same list Zápis shows — and always the row's own,
	 * even if it is archived or on the other side, so what it has is never
	 * hidden from it.
	 */
	const editCategories = $derived.by(() => {
		if (!editing) return [];
		const income = editing.amount > 0;
		const accountId = editing.accountId;
		const live = categories.filter((c) => !c.isDeleted && !c.isArchived && c.isIncome === income);
		const own = editing.categoryId ? categoryById.get(editing.categoryId) : undefined;
		if (own && !live.some((c) => c.id === own.id)) live.push(own);
		const byId = new Map(live.map((c) => [c.id, c]));
		return categoryRanking(
			ledger.filter((t) => t.accountId === accountId),
			[...byId.keys()]
		)
			.map((id) => byId.get(id)!)
			.filter(Boolean);
	});

	const editCategoryRow = $derived(editCategory ? (categoryById.get(editCategory) ?? null) : null);

	/** A bucket made from the picker is the bucket this row goes to. */
	async function addEditCategory(input: CategoryInput) {
		const created = await createCategory(input);
		editCategory = created.id;
	}

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

	/** Opens the sheet on a row. The fields are a copy; nothing is written until Uložit. */
	export function open(txn: Txn) {
		editing = txn;
		editAmount = formatMoney(txn.amount, { currency: false, sign: 'never' });
		editDate = txn.date;
		editCategory = txn.categoryId ?? '';
		editPayee = txn.payee;
		editNote = txn.note ?? '';
		editProvisional = txn.isProvisional === true;
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

	/**
	 * What "Přijato" will record for a share: the figure in its field, when
	 * that is an amount — the friend who owed 10 Kč and sent 11 (Q82) — and
	 * the stored share otherwise.
	 */
	function receivedAmount(row: EditShare): Minor | null {
		const stored = row.id !== null ? storedShares.get(row.id) : undefined;
		if (!stored) return null;
		const typed = parseAmount(row.amount);
		return typed.ok && typed.value > 0 ? typed.value : stored.amount;
	}

	async function receive(row: EditShare) {
		if (!editing || row.id === null) return;
		const txnId = editing.id;
		const shareId = row.id;
		const currency = code;
		/* Captured before the write: the undo puts back what was owed. */
		const owed = storedShares.get(shareId)?.amount;
		const amount = receivedAmount(row) ?? undefined;
		editing = null;
		const repayment = await settleReceivable(txnId, shareId, { amount });
		if (!repayment) return;
		toast.money(repayment.amount, {
			message: repayment.payee,
			code: currency,
			undo: () => unsettleReceivable(txnId, shareId, owed)
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

		/* No ceiling at the expense (Q82): a thank-you on top is money that
		   comes back, and the form has no business refusing it. */
		const shares: TxnShare[] = [];
		if (amount < 0) {
			for (const row of editShares) {
				if (row.settledByTxnId !== null && row.id !== null) {
					const saved = storedShares.get(row.id);
					if (saved) shares.push(saved);
					continue;
				}
				if (!row.amount.trim()) continue;
				const share = parseAmount(row.amount);
				if (!share.ok || share.value <= 0) {
					editError = 'Dlužná částka není částka.';
					return;
				}
				shares.push({
					id: row.id ?? uuidv7(),
					who: row.who,
					amount: share.value,
					settledByTxnId: null
				});
			}
		}

		await updateTxn(editing.id, {
			amount,
			date: editDate,
			categoryId: editCategory || null,
			payee: editPayee,
			note: editNote,
			/* The switch is shown under an expense only; an income never carries it. */
			isProvisional: amount < 0 && editProvisional,
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
</script>

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

		{#if editing && isMove(editing)}
			<!-- A move has no bucket, and that is what makes it a move (Q83):
			     offering one here would turn cash out of the ATM into spending. -->
			<p class="field__hint">
				Tohle je jedna strana převodu mezi tvými účty. Peníze se jen přesunuly, takže to není výdaj
				ani příjem a do přehledu měsíce se nepočítá. Smazáním zmizí obě strany.
			</p>
		{:else}
			<div class="field">
				<span class="field__label">Kategorie</span>
				<button type="button" class="field__input bucket" onclick={() => (pickingCategory = true)}>
					{#if editCategoryRow}
						{@const style = categoryStyle(editCategoryRow)}
						<span class="circle circle--xs" style="--c: {colorVar(style.color)}">
							<Icon name={style.icon} size={14} stroke={2} />
						</span>
						<span class="bucket__name">{editCategoryRow.name}</span>
					{:else}
						<span class="circle circle--xs" style="--c: var(--flag)">
							<Icon name="tag" size={14} stroke={2} />
						</span>
						<span class="bucket__name bucket__name--none">bez kategorie</span>
					{/if}
					<span class="card__go"><Icon name="chevron-right" size={16} /></span>
				</button>
			</div>

			{#if editing?.transferPairId !== null}
				<p class="field__hint">
					Tohle je jedna strana převodu mezi účty. Co odešlo, je výdaj z vybrané kategorie; co
					dorazilo, je příjem ve SMĚNA. Smazáním zmizí obě strany.
				</p>
			{/if}
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
			<div class="prop">
				<button
					type="button"
					class="toggle"
					role="switch"
					aria-checked={editProvisional}
					aria-label="Blokovaná částka"
					onclick={() => (editProvisional = !editProvisional)}
				></button>
				<span class="prop__name" class:prop__name--on={editProvisional}> Blokovaná částka </span>
			</div>
			{#if editProvisional}
				<p class="field__hint">
					Banka ji zatím jen zablokovala. Až se usadí, přepiš ji nahoře a přepínač vypni.
				</p>
			{/if}

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
							{@const owed = storedShares.get(row.id)!.amount}
							{@const received = receivedAmount(row) ?? owed}
							<button type="button" class="btn btn--block owed__ok" onclick={() => receive(row)}>
								Přijato — {formatMoney(received, { code })}
							</button>
							{#if received > owed}
								<p class="field__hint">
									O {formatMoney((received - owed) as Minor, { code })} víc, než dlužil — díky navíc se
									zapíše taky.
								</p>
							{/if}
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
						má vrátit — až dorazí, odškrtneš to a zapíše se příjem, za každého zvlášť. Poslal víc,
						třeba jako díky? Přepiš částku a ťukni na Přijato.
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

<CategoryPickerSheet
	open={pickingCategory}
	categories={editCategories}
	selectedId={editCategory || null}
	isIncome={(editing?.amount ?? 0) > 0}
	onselect={(id) => (editCategory = id)}
	oncreate={addEditCategory}
	onclose={() => (pickingCategory = false)}
/>

<style>
	.prop {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		color: var(--ink-2);
		font-size: var(--text-md);
	}

	.prop__name--on {
		color: var(--ink);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* The category field is a button that reads like a row: the bucket's
	   circle, its name, and the chevron that says it opens the whole list. */
	.bucket {
		display: flex;
		align-items: center;
		gap: 10px;
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.bucket:active {
		background: var(--surface-2);
	}

	.bucket__name {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bucket__name--none {
		color: var(--flag);
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
