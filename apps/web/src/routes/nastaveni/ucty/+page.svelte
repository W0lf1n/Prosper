<script lang="ts">
	/**
	 * Nastavení · Účty — every live account with what is on it right now, by
	 * currency, the pockets that joined it indented underneath (Q50, Q52).
	 * Tapping an account that is not the active one makes it the account the
	 * keypad writes to; the opening figures and the pockets fold behind
	 * Upravit once the ledger has a row in it.
	 *
	 * Since Q83 a currency may hold several accounts — the card and the cash —
	 * so Přidat účet is always offered, every currency is in its select, and a
	 * pocket can become an account of its own. An opening balance may be zero
	 * or below (Q85): the sign is a pill, because the keypad has no minus.
	 */
	import { liveQuery } from 'dexie';
	import { invalidateAll } from '$app/navigation';
	import { db } from '$lib/db/schema';
	import {
		addPocket,
		createAccount,
		createTransfer,
		pocketToAccount,
		removePocket,
		setActiveAccountId,
		updateAccount,
		type Transfer
	} from '$lib/db/repo';
	import {
		ACCOUNT_KIND_LABEL,
		guessAccountKind,
		homeCurrency,
		liveAccounts,
		pocketsOf,
		validatePocket
	} from '$lib/domain/accounts';
	import { formatShortDate, today } from '$lib/domain/datetime';
	import { balancesByCurrency } from '$lib/domain/ledger';
	import {
		CURRENCIES,
		abs,
		currencyName,
		currencySymbol,
		formatMoney,
		parseAmount,
		parseSigned,
		sum
	} from '$lib/domain/money';
	import type { Account, AccountKind, Category, Txn } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import BottomSheet from '$lib/ui/Sheet.svelte';
	import SignedAmount from '$lib/ui/SignedAmount.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import TransferSheet, { type TransferInput } from '$lib/ui/TransferSheet.svelte';
	import { accountColor, accountGlyph, colorVar } from '$lib/ui/palette';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const allAccounts = liveQuery(() => db().accounts.toArray());
	const accountRows = $derived(liveAccounts(($allAccounts ?? []) as Account[]));
	/* Derived from the live list, not its own `liveQuery`: this is the one
	   screen an account switch happens on (`CLAUDE.md`). */
	const account = $derived(
		(($allAccounts ?? []) as Account[]).find((a) => a.id === data.accountId) ?? null
	);
	const otherAccounts = $derived(accountRows.filter((a) => a.id !== data.accountId));
	const activeCurrency = $derived(account?.currency ?? 'CZK');
	const home = $derived(homeCurrency(($allAccounts ?? []) as Account[]));
	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const exchanges = liveQuery(() =>
		db()
			.txns.filter((t) => t.transferPairId !== null)
			.toArray()
	);
	/* Live rows, not every row ever written — tombstones only ever go up. */
	const allTxns = liveQuery(async () =>
		(await db().txns.toArray()).filter((t: Txn) => !t.isDeleted)
	);
	const txnCount = $derived(($allTxns ?? []).length);

	const balances = $derived(
		balancesByCurrency(($allAccounts ?? []) as Account[], ($allTxns ?? []) as Txn[])
	);

	// ── the active account ──────────────────────────────────────────────────
	let accountName = $derived(account?.name ?? '');
	let accountKind = $derived<AccountKind>(account?.kind ?? 'checking');
	/* The magnitude in the field, the side of zero on the pill (Q85). */
	let openingBalance = $derived(
		account ? formatMoney(abs(account.openingBalance), { currency: false }) : ''
	);
	let openingNegative = $derived((account?.openingBalance ?? 0) < 0);
	let openingDate = $derived(account?.openingDate ?? today());
	let accountError = $state('');

	/** Setup, not maintenance: the form folds once there is a ledger. */
	let accountOpen = $state<boolean | null>(null);
	const accountExpanded = $derived(accountOpen ?? txnCount === 0);

	async function saveAccount() {
		if (!data.accountId) return;
		const parsed = parseSigned(openingBalance.trim() || '0', openingNegative);
		if (!parsed.ok) {
			accountError = 'Počáteční zůstatek není částka.';
			return;
		}
		accountError = '';
		await updateAccount(data.accountId, {
			name: accountName.trim() || 'Účet',
			kind: accountKind,
			openingBalance: parsed.value,
			openingDate
		});
		accountOpen = null;
		toast.show('Účet uložen');
	}

	// ── money elsewhere (Q50) ───────────────────────────────────────────────
	const pockets = $derived(account ? pocketsOf(account) : []);
	const pocketsTotal = $derived(sum(pockets.map((p) => p.amount)));
	let pocketName = $state('');
	let pocketAmount = $state('');
	let pocketError = $state('');

	async function savePocket() {
		if (!data.accountId) return;
		const parsed = parseAmount(pocketAmount);
		if (!parsed.ok) {
			pocketError = 'Částka není číslo.';
			return;
		}
		const problems = validatePocket({ name: pocketName, amount: parsed.value });
		if (problems.includes('name')) {
			pocketError = 'Napiš, kde ty peníze jsou — třeba Revolut.';
			return;
		}
		if (problems.includes('amount')) {
			pocketError = 'Částka musí být větší než nula.';
			return;
		}
		pocketError = '';
		await addPocket(data.accountId, { name: pocketName, amount: parsed.value });
		pocketName = '';
		pocketAmount = '';
		toast.show(`K účtu přičteno ${formatMoney(parsed.value, { code: activeCurrency })}`);
	}

	async function dropPocket(id: string) {
		if (!data.accountId) return;
		await removePocket(data.accountId, id);
	}

	/** A pocket becomes an account of its own (Q83) — the totals do not move. */
	async function promotePocket(id: string) {
		if (!data.accountId) return;
		const created = await pocketToAccount(data.accountId, id);
		if (created) toast.show(`„${created.name}“ je teď samostatný účet`);
	}

	async function switchTo(next: Account) {
		await setActiveAccountId(next.id);
		await invalidateAll();
		toast.show(`Zapisuje se na „${next.name}“`);
	}

	// ── adding an account ───────────────────────────────────────────────────
	let addOpen = $state(false);
	let newAccountName = $state('');
	let newAccountKind = $state<AccountKind>('checking');
	/** Until the kind is picked by hand, it follows the name — "Hotovost" is cash. */
	let newAccountKindTouched = $state(false);
	let newAccountCurrency = $state('CZK');
	let newAccountBalance = $state('');
	let newAccountNegative = $state(false);
	let newAccountDate = $state(today());
	let newAccountError = $state('');

	const ACCOUNT_KINDS = Object.entries(ACCOUNT_KIND_LABEL) as [AccountKind, string][];

	/** Every offered currency, named — "PLN — polský zlotý · zł". Home first,
	    as the list already is; any currency, held or not (Q83, Q84). */
	const CURRENCY_OPTIONS = CURRENCIES.map((code) => {
		const symbol = currencySymbol(code);
		return {
			code,
			label: `${code} — ${currencyName(code)}${symbol === code ? '' : ` · ${symbol}`}`
		};
	});

	function openAdd() {
		newAccountCurrency = home;
		addOpen = true;
	}

	function typeNewName() {
		if (!newAccountKindTouched) newAccountKind = guessAccountKind(newAccountName);
	}

	async function addAccount() {
		const name = newAccountName.trim();
		if (!name) {
			newAccountError = 'Pojmenuj účet.';
			return;
		}
		const parsed = parseSigned(newAccountBalance.trim() || '0', newAccountNegative);
		if (!parsed.ok) {
			newAccountError = 'Počáteční zůstatek není částka.';
			return;
		}
		newAccountError = '';
		await createAccount({
			name,
			kind: newAccountKind,
			currency: newAccountCurrency,
			openingBalance: parsed.value,
			openingDate: newAccountDate
		});
		addOpen = false;
		newAccountName = '';
		newAccountBalance = '';
		newAccountNegative = false;
		newAccountCurrency = home;
		newAccountKind = 'checking';
		newAccountKindTouched = false;
		newAccountDate = today();
		toast.show(`Účet „${name}“ přidán`);
	}

	let confirmingArchive = $state(false);

	async function archiveActive() {
		const successor = otherAccounts[0];
		const doomed = account;
		if (!successor || !doomed || !data.accountId) return;
		await setActiveAccountId(successor.id);
		await updateAccount(doomed.id, { isArchived: true });
		confirmingArchive = false;
		accountOpen = null;
		await invalidateAll();
		toast.show(`„${doomed.name}“ archivován — zapisuje se na „${successor.name}“`);
	}

	// ── transfer ────────────────────────────────────────────────────────────
	let transferOpen = $state(false);

	async function saveTransfer(input: TransferInput) {
		const transfer: Transfer = await createTransfer(input);
		transferOpen = false;
		toast.money(transfer.out.amount, {
			message: transfer.out.payee,
			code: accountRows.find((a) => a.id === input.fromAccountId)?.currency
		});
	}
</script>

<svelte:head>
	<title>Prosper — účty</title>
</svelte:head>

{#snippet accountCircle(row: Account)}
	{@const glyph = accountGlyph(row, accountRows)}
	<span class="circle" style="--c: {colorVar(accountColor(row.currency, home))}">
		{#if 'icon' in glyph}
			<Icon name={glyph.icon} size={18} stroke={2} />
		{:else}
			{glyph.symbol}
		{/if}
	</span>
{/snippet}

<main class="page">
	<AppBar title="Účty" back="/nastaveni" />

	<section class="card">
		{#each balances as group (group.code)}
			<div class="group">
				{#if group.lines.length > 1 || balances.length > 1}
					<div class="group__head">
						<span class="label">{group.code}{group.lines.length > 1 ? ' · celkem' : ''}</span>
						{#if group.lines.length > 1}
							<span class="group__total">{formatMoney(group.total, { code: group.code })}</span>
						{/if}
					</div>
				{/if}
				{#each group.lines as line (line.pocket?.id ?? line.account.id)}
					{#if line.pocket}
						<div class="row row--short acct acct--pocket">
							<span class="circle circle--sm circle--soft acct__pocket">·</span>
							<span class="row__body">
								<span class="acct__name">{line.name}</span>
								<span class="row__sub">peníze jinde</span>
							</span>
							<span class="row__amount acct__amount"
								>{formatMoney(line.amount, { code: group.code })}</span
							>
						</div>
					{:else if line.account.id === data.accountId}
						<div class="row row--short acct">
							{@render accountCircle(line.account)}
							<span class="row__body">
								<span class="row__title">{line.name}</span>
								<span class="row__sub"
									>{ACCOUNT_KIND_LABEL[line.account.kind]} · zapisuje se sem</span
								>
							</span>
							<span class="row__amount">{formatMoney(line.amount, { code: group.code })}</span>
						</div>
					{:else}
						<button
							type="button"
							class="row row--short row--press acct"
							onclick={() => switchTo(line.account)}
						>
							{@render accountCircle(line.account)}
							<span class="row__body">
								<span class="row__title">{line.name}</span>
								<span class="row__sub"
									>{ACCOUNT_KIND_LABEL[line.account.kind]} · ťukni a zapisuj sem</span
								>
							</span>
							<span class="row__amount">{formatMoney(line.amount, { code: group.code })}</span>
						</button>
					{/if}
				{/each}
			</div>
		{/each}

		<div class="actions actions--fill">
			<button type="button" class="btn" onclick={openAdd}>Přidat účet</button>
			<button type="button" class="btn" onclick={() => (accountOpen = !accountExpanded)}>
				{accountExpanded ? 'Skrýt' : 'Upravit'}
			</button>
			{#if accountRows.length > 1}
				<button type="button" class="btn" onclick={() => (transferOpen = true)}>Převod</button>
			{/if}
		</div>

		{#if accountExpanded}
			<div class="edit">
				<label class="field">
					<span class="field__label">Název</span>
					<input class="field__input" bind:value={accountName} />
				</label>

				<label class="field">
					<span class="field__label">Druh</span>
					<select class="field__input" bind:value={accountKind}>
						{#each ACCOUNT_KINDS as [kind, label] (kind)}
							<option value={kind}>{label}</option>
						{/each}
					</select>
				</label>

				<SignedAmount
					label="Počáteční zůstatek"
					bind:text={openingBalance}
					bind:negative={openingNegative}
				/>

				<label class="field">
					<span class="field__label">Ke dni</span>
					<input class="field__input" type="date" bind:value={openingDate} />
				</label>

				<!-- Money in this currency that sits somewhere else — Q50. -->
				<div class="field">
					<span class="field__label">Peníze jinde</span>

					{#if pockets.length > 0}
						<ul class="pockets">
							{#each pockets as pocket (pocket.id)}
								<li class="pocket">
									<span class="pocket__name">{pocket.name}</span>
									<span class="pocket__amount"
										>{formatMoney(pocket.amount, { code: activeCurrency })}</span
									>
									<button
										type="button"
										class="btn btn--sm pocket__promote"
										onclick={() => promotePocket(pocket.id)}
									>
										Na účet
									</button>
									<button
										type="button"
										class="pocket__drop"
										aria-label={`Odebrat ${pocket.name}`}
										onclick={() => dropPocket(pocket.id)}
									>
										<Icon name="close" size={16} />
									</button>
								</li>
							{/each}
						</ul>
					{/if}

					<div class="pocket-add">
						<input
							class="field__input"
							bind:value={pocketName}
							placeholder="Revolut"
							aria-label="Kde"
						/>
						<input
							class="field__input"
							bind:value={pocketAmount}
							inputmode="decimal"
							placeholder="0"
							aria-label="Kolik"
						/>
						<button type="button" class="btn btn--lg" onclick={savePocket}>Přidat</button>
					</div>

					{#if pocketError}
						<p class="error-text">{pocketError}</p>
					{/if}

					<span class="field__hint">
						Částka v téhle měně, která leží jinde a jen se přičte k zůstatku tohohle účtu. Hotovost
						nebo druhá karta, ze které zapisuješ zvlášť, patří na vlastní účet{pockets.length > 0
							? ' — Na účet ji tam převede i se zůstatkem'
							: ''}.
					</span>
				</div>

				{#if accountError}
					<p class="error-text">{accountError}</p>
				{/if}

				<button type="button" class="btn btn--primary btn--block" onclick={saveAccount}
					>Uložit účet</button
				>

				<p class="hint">
					Zůstatek se počítá z počátečního stavu a všech záznamů. Zadej ho přesně tak, jak ho
					ukazovala banka k uvedenému dni — jinak nebude sedět nikdy. Měna je daná při založení ({activeCurrency})
					— účet s historií ji změnit nemůže.
					{#if pocketsTotal > 0}
						Jinde je {formatMoney(pocketsTotal, { code: activeCurrency })}.
					{/if}
					Účet začal {formatShortDate(openingDate)}.
				</p>

				{#if otherAccounts.length > 0}
					{#if confirmingArchive}
						<div class="ask">
							<p class="hint">
								Archivovat „{account?.name}“? Záznamy zůstanou, zapisovat se bude na „{otherAccounts[0]
									?.name}“.
							</p>
							<div class="actions actions--fill">
								<button type="button" class="btn" onclick={() => (confirmingArchive = false)}
									>Zpět</button
								>
								<button type="button" class="btn btn--danger" onclick={archiveActive}
									>Archivovat</button
								>
							</div>
						</div>
					{:else}
						<button
							type="button"
							class="btn btn--quiet btn--block"
							onclick={() => (confirmingArchive = true)}
						>
							Archivovat účet
						</button>
					{/if}
				{/if}
			</div>
		{/if}

		<p class="hint">
			Klávesnice zapisuje na aktivní účet; přepnout jde tady, nebo na obrazovce zápisu posunutím
			karty účtu. V jedné měně může být účtů víc — karta i hotovost; měsíc se počítá za všechny
			dohromady a výběr z bankomatu je převod, ne výdaj. Mezi měnami se nesčítá nic: kurz se nikde
			nebere.
		</p>
	</section>
</main>

<!-- ── nový účet ─────────────────────────────────────────────────────── -->
<BottomSheet open={addOpen} title="Nový účet" onclose={() => (addOpen = false)}>
	<div class="form">
		<label class="field">
			<span class="field__label">Název</span>
			<input
				class="field__input"
				bind:value={newAccountName}
				oninput={typeNewName}
				placeholder="Hotovost"
			/>
		</label>

		<div class="pair">
			<label class="field">
				<span class="field__label">Druh</span>
				<select
					class="field__input"
					bind:value={newAccountKind}
					onchange={() => (newAccountKindTouched = true)}
				>
					{#each ACCOUNT_KINDS as [kind, label] (kind)}
						<option value={kind}>{label}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span class="field__label">Měna</span>
				<select class="field__input" bind:value={newAccountCurrency}>
					{#each CURRENCY_OPTIONS as option (option.code)}
						<option value={option.code}>{option.label}</option>
					{/each}
				</select>
			</label>
		</div>
		<span class="field__hint">
			Měna je napořád — účet s historií ji změnit nemůže. Druhý účet v měně, kterou už máš, je v
			pořádku: karta a hotovost se v přehledu měsíce sečtou.
		</span>

		<SignedAmount
			label="Počáteční zůstatek"
			bind:text={newAccountBalance}
			bind:negative={newAccountNegative}
		/>
		<span class="field__hint">
			Nula je v pořádku. V mínusu je účet, na kterém dlužíš — kontokorent, kreditka, půjčka.
		</span>

		<label class="field">
			<span class="field__label">Ke dni</span>
			<input class="field__input" type="date" bind:value={newAccountDate} />
		</label>

		{#if newAccountError}
			<p class="error-text">{newAccountError}</p>
		{/if}

		<button type="button" class="btn btn--primary btn--block" onclick={addAccount}
			>Založit účet</button
		>
	</div>
</BottomSheet>

<TransferSheet
	open={transferOpen}
	accounts={($allAccounts ?? []) as Account[]}
	categories={($categories ?? []) as Category[]}
	exchanges={($exchanges ?? []) as Txn[]}
	defaultFromId={data.accountId}
	onsave={saveTransfer}
	onclose={() => (transferOpen = false)}
/>

<TabBar />

<style>
	.group {
		display: flex;
		flex-direction: column;
	}

	.group__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 36px;
	}

	.group__total {
		font-weight: 600;
	}

	.acct + .acct {
		border-top: none;
	}

	.acct--pocket .acct__name {
		font-size: var(--text-base);
		color: var(--ink-2);
	}

	.acct__pocket {
		color: var(--ink-3);
	}

	.acct__amount {
		font-weight: 400;
		color: var(--ink-2);
	}

	.edit {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding-top: var(--space-2);
		border-top: 1px solid var(--hairline);
	}

	.ask {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-wash);
	}

	.pockets {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.pocket {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--touch);
		padding-left: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-3);
	}

	.pocket__name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pocket__amount {
		font-weight: 600;
	}

	.pocket__promote {
		flex: none;
	}

	.pocket__drop {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--touch);
		height: var(--touch);
		color: var(--ink-3);
	}

	.pocket-add {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(5.5rem, 0.7fr) auto;
		gap: var(--space-2);
		align-items: stretch;
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 360px) {
		.pair {
			grid-template-columns: 1fr;
		}
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
