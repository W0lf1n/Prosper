<script lang="ts">
	import { liveQuery } from 'dexie';
	import { page } from '$app/state';
	import { db, SCHEMA_VERSION } from '$lib/db/schema';
	import {
		CurrencyTakenError,
		addPocket,
		createAccount,
		createCategory,
		createTransfer,
		exportBackup,
		importBackup,
		removePocket,
		resetLedger,
		setActiveAccountId,
		updateAccount,
		updateCategory,
		type Backup,
		type Transfer
	} from '$lib/db/repo';
	import { invalidateAll } from '$app/navigation';
	import {
		ACCOUNT_KIND_LABEL,
		availableCurrencies,
		homeCurrency,
		liveAccounts,
		pocketsOf,
		validatePocket
	} from '$lib/domain/accounts';
	import { ZERO, currencySymbol, formatMoney, parseAmount, sum } from '$lib/domain/money';
	import { formatDateTime, formatShortDate, today } from '$lib/domain/datetime';
	import { summariseMonth } from '$lib/domain/checks';
	import { RECORDS, counted } from '$lib/domain/czech';
	import { KIND_LABEL } from '$lib/domain/holdings';
	import { balancesByCurrency } from '$lib/domain/ledger';
	import { monthlyRows, monthsCovered } from '$lib/domain/trends';
	import { sharesOf } from '$lib/domain/receivables';
	import { buildXlsx, type Sheet } from '$lib/domain/xlsx';
	import type { Account, AccountKind, Category, Txn } from '$lib/domain/types';
	import type { Minor } from '$lib/domain/money';
	import { applyTheme, readTheme, type Theme } from '$lib/ui/theme';
	import { defaultBaseUrl, pair, unpair } from '$lib/sync/pair';
	import { initSync, syncNow, syncStatus } from '$lib/sync/status.svelte';
	import AppBar from '$lib/ui/AppBar.svelte';
	import CategorySheet, { type CategoryInput } from '$lib/ui/CategorySheet.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ResetSheet from '$lib/ui/ResetSheet.svelte';
	import BottomSheet from '$lib/ui/Sheet.svelte';
	import TransferSheet, { type TransferInput } from '$lib/ui/TransferSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { accountColor, categoryStyle, colorVar } from '$lib/ui/palette';
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

	const TYPE_LABEL: Record<Category['spendType'], string> = {
		need: 'nutné',
		want: 'chtěné',
		give: 'dávání',
		save: 'spoření',
		debt: 'dluh'
	};

	/* A row on Já links here with a hash; the page's own scroll region is what
	   has to move, so the browser's default is not enough. */
	$effect(() => {
		const id = page.url.hash.slice(1);
		if (!id) return;
		requestAnimationFrame(() =>
			document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
		);
	});

	// ── account ─────────────────────────────────────────────────────────────
	let accountName = $derived(account?.name ?? '');
	let openingBalance = $derived(
		account ? formatMoney(account.openingBalance, { currency: false }) : ''
	);
	let openingDate = $derived(account?.openingDate ?? today());
	let accountError = $state('');

	/** Setup, not maintenance: the form folds once there is a ledger. */
	let accountOpen = $state<boolean | null>(null);
	const accountExpanded = $derived(accountOpen ?? txnCount === 0);

	async function saveAccount() {
		if (!data.accountId) return;
		const parsed = parseAmount(openingBalance);
		if (!parsed.ok) {
			accountError = 'Počáteční zůstatek není částka.';
			return;
		}
		accountError = '';
		await updateAccount(data.accountId, {
			name: accountName.trim() || 'Účet',
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

	async function switchTo(next: Account) {
		await setActiveAccountId(next.id);
		await invalidateAll();
		toast.show(`Zapisuje se na „${next.name}“`);
	}

	// ── adding an account ───────────────────────────────────────────────────
	let addOpen = $state(false);
	let newAccountName = $state('');
	let newAccountKind = $state<AccountKind>('checking');
	let newAccountCurrency = $state('CZK');
	let newAccountBalance = $state('');
	let newAccountDate = $state(today());
	let newAccountError = $state('');

	const ACCOUNT_KINDS = Object.entries(ACCOUNT_KIND_LABEL) as [AccountKind, string][];
	const freeCurrencies = $derived(availableCurrencies(($allAccounts ?? []) as Account[]));

	function openAdd() {
		newAccountCurrency = freeCurrencies[0] ?? 'CZK';
		addOpen = true;
	}

	async function addAccount() {
		const name = newAccountName.trim();
		if (!name) {
			newAccountError = 'Pojmenuj účet.';
			return;
		}
		const parsed = newAccountBalance.trim()
			? parseAmount(newAccountBalance)
			: ({ ok: true, value: ZERO } as const);
		if (!parsed.ok) {
			newAccountError = 'Počáteční zůstatek není částka.';
			return;
		}
		newAccountError = '';
		try {
			await createAccount({
				name,
				kind: newAccountKind,
				currency: newAccountCurrency,
				openingBalance: parsed.value,
				openingDate: newAccountDate
			});
		} catch (error) {
			if (error instanceof CurrencyTakenError) {
				newAccountError = `Účet v ${error.currency} už máš — další peníze v téhle měně přidej k němu jako peníze jinde.`;
				return;
			}
			throw error;
		}
		addOpen = false;
		newAccountName = '';
		newAccountBalance = '';
		newAccountCurrency = 'CZK';
		newAccountKind = 'checking';
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

	// ── categories ──────────────────────────────────────────────────────────
	const visibleCategories = $derived(
		(($categories ?? []) as Category[]).filter((c) => !c.isDeleted)
	);
	let categorySheetOpen = $state(false);
	let editingCategoryId = $state<string | null>(null);
	/* Read back out of the live list, so the sheet sees each patch land. */
	const editingCategory = $derived(
		editingCategoryId ? (visibleCategories.find((c) => c.id === editingCategoryId) ?? null) : null
	);

	function openCategory(category: Category | null) {
		editingCategoryId = category?.id ?? null;
		categorySheetOpen = true;
	}

	async function addCategory(input: CategoryInput) {
		await createCategory(input);
		categorySheetOpen = false;
		toast.show(`Kategorie „${input.name}“ přidána`);
	}

	async function patchCategory(
		id: string,
		patch: Partial<CategoryInput> & { isArchived?: boolean }
	) {
		await updateCategory(id, patch);
	}

	// ── theme ───────────────────────────────────────────────────────────────
	let theme = $state<Theme>(readTheme());

	function chooseTheme(next: Theme) {
		theme = next;
		applyTheme(next);
	}

	// ── backup ──────────────────────────────────────────────────────────────
	let importInput = $state<HTMLInputElement | null>(null);

	async function downloadBackup() {
		const backup = await exportBackup();
		const blob = new Blob([JSON.stringify(backup, null, '\t')], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `prosper-zaloha-${today()}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	async function downloadWorkbook() {
		const database = db();
		const [rows, cats, goalRows, holdingRows, valuationRows] = await Promise.all([
			data.accountId
				? database.txns.where('accountId').equals(data.accountId).toArray()
				: database.txns.toArray(),
			database.categories.toArray(),
			database.goals.toArray(),
			database.holdings.toArray(),
			database.valuations.toArray()
		]);

		const live = rows.filter((t) => !t.isDeleted);
		const nameOf = (id: string | null) =>
			id === null ? 'bez kategorie' : (cats.find((c) => c.id === id)?.name ?? 'bez kategorie');

		const ledger: Sheet = {
			name: 'Záznamy',
			header: [
				'Datum',
				'Kategorie',
				'Popis',
				'Částka',
				'Typ',
				'Jednorázový',
				'Dluží mi',
				'Kdo',
				'Vyrovnáno'
			],
			rows: [...live]
				.sort((a, b) => a.date.localeCompare(b.date))
				.map((t) => {
					const shares = sharesOf(t);
					const owedTotal = shares.reduce((total, s) => total + s.amount, 0);
					const settled = shares.filter((s) => s.settledByTxnId !== null).length;
					return [
						{ date: t.date },
						nameOf(t.categoryId),
						t.payee,
						{ money: t.amount },
						cats.find((c) => c.id === t.categoryId)?.spendType ?? '',
						t.isOneOff ? 'ano' : '',
						owedTotal > 0 ? { money: owedTotal as Minor } : null,
						shares.map((s) => s.who.trim() || 'někdo').join(', '),
						shares.length === 0
							? ''
							: settled === shares.length
								? 'ano'
								: settled > 0
									? 'zčásti'
									: ''
					];
				})
		};

		const months = monthsCovered(live);
		const summary: Sheet = {
			name: 'Měsíce',
			header: ['Měsíc', 'Příjem', 'Výdaje', 'Čistý', 'Běžný chod', 'Jednorázové'],
			rows: monthlyRows({ months, txns: live, categories: cats, today: today() }).map((m) => [
				m.month,
				{ money: m.income },
				{ money: m.outflow },
				{ money: m.net },
				{ money: m.recurringOutflow },
				{ money: m.oneOffOutflow }
			])
		};

		const perCategory: Sheet = {
			name: 'Kategorie po měsících',
			header: ['Měsíc', 'Kategorie', 'Typ', 'Částka', 'Počet'],
			rows: months.flatMap((m) =>
				summariseMonth({ month: m, txns: live, categories: cats, today: today() })
					.buckets.filter((b) => b.total !== 0)
					.map((b) => [
						m,
						b.category?.name ?? 'bez kategorie',
						b.category?.spendType ?? '',
						{ money: b.total },
						b.count
					])
			)
		};

		const goalsSheet: Sheet = {
			name: 'Cíle',
			header: ['Cíl', 'Proč', 'Cílová částka', 'Termín', 'Počítá se od', 'Kategorie'],
			rows: goalRows
				.filter((g) => !g.isDeleted)
				.map((g) => [
					g.name,
					g.why,
					{ money: g.targetAmount },
					{ date: g.targetDate },
					{ date: g.startDate },
					nameOf(g.categoryId)
				])
		};

		const wealthSheet: Sheet = {
			name: 'Jmění',
			header: ['Investice', 'Druh', 'Datum hodnoty', 'Hodnota'],
			rows: holdingRows
				.filter((h) => !h.isDeleted && !h.isArchived)
				.flatMap((h) =>
					valuationRows
						.filter((v) => !v.isDeleted && v.holdingId === h.id)
						.sort((a, b) => a.date.localeCompare(b.date))
						.map((v) => [h.name, KIND_LABEL[h.kind], { date: v.date }, { money: v.value }])
				)
		};

		const bytes = buildXlsx([ledger, summary, perCategory, goalsSheet, wealthSheet]);
		const blob = new Blob([bytes as BlobPart], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `prosper-${today()}.xlsx`;
		link.click();
		URL.revokeObjectURL(url);
		toast.show(`Vyexportováno ${counted(live.length, RECORDS)}`);
	}

	async function runImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const parsed = JSON.parse(await file.text()) as Backup;
			const result = await importBackup(parsed);
			toast.show(
				result.skipped > 0
					? `Načteno ${counted(result.txns, RECORDS)}. Poškozené řádky vynechány: ${result.skipped}.`
					: `Načteno ${counted(result.txns, RECORDS)}`
			);
		} catch (error) {
			toast.show(error instanceof Error ? error.message : 'Zálohu se nepodařilo načíst');
		} finally {
			input.value = '';
		}
	}

	// ── sync ────────────────────────────────────────────────────────────────
	const sync = syncStatus();
	let syncBaseUrl = $state(defaultBaseUrl());
	let syncCode = $state('');
	let syncDeviceName = $state('');
	let syncBusy = $state(false);
	let syncError = $state('');

	$effect(() => {
		void initSync();
	});

	async function runPair() {
		syncBusy = true;
		syncError = '';
		try {
			await pair({
				baseUrl: syncBaseUrl.trim(),
				code: syncCode.trim(),
				deviceName: syncDeviceName.trim() || 'Telefon'
			});
			syncCode = '';
			toast.show('Spárováno');
		} catch (error) {
			syncError = error instanceof Error ? error.message : 'Spárovat se nepodařilo';
		} finally {
			syncBusy = false;
		}
	}

	async function runUnpair() {
		await unpair();
		toast.show('Odpojeno');
	}

	const SYNC_LABEL: Record<string, string> = {
		off: 'nepřipojeno',
		idle: 'v pořádku',
		running: 'probíhá',
		error: 'chyba'
	};

	// ── starting over ───────────────────────────────────────────────────────
	let resetOpen = $state(false);

	async function pushBeforeReset(): Promise<{ ok: boolean; error: string | null }> {
		await syncNow();
		if (sync.state === 'error') return { ok: false, error: sync.lastError };
		if (sync.pending > 0) {
			return { ok: false, error: `${counted(sync.pending, RECORDS)} zatím čeká ve frontě` };
		}
		return { ok: true, error: null };
	}

	async function runReset() {
		const result = await resetLedger();
		resetOpen = false;
		toast.show(result.txns > 0 ? `Smazáno ${counted(result.txns, RECORDS)}` : 'Sešit je prázdný');
	}

	// ── storage ─────────────────────────────────────────────────────────────
	let persisted = $state<boolean | null>(null);

	$effect(() => {
		void navigator.storage?.persisted?.().then((value) => (persisted = value));
	});

	async function requestPersistence() {
		persisted = (await navigator.storage?.persist?.()) ?? false;
	}
</script>

<svelte:head>
	<title>Prosper — nastavení</title>
</svelte:head>

<main class="page">
	<AppBar title="Nastavení" />

	<!-- ── účty ──────────────────────────────────────────────────────── -->
	<section class="card" id="ucty">
		<h2 class="label">Účty</h2>

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
							<span
								class="circle"
								style="--c: {colorVar(accountColor(line.account.currency, home))}"
							>
								{currencySymbol(line.account.currency)}
							</span>
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
							<span
								class="circle"
								style="--c: {colorVar(accountColor(line.account.currency, home))}"
							>
								{currencySymbol(line.account.currency)}
							</span>
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
			{#if freeCurrencies.length > 0}
				<button type="button" class="btn" onclick={openAdd}>Přidat účet</button>
			{/if}
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
					<span class="field__label">Počáteční zůstatek</span>
					<input class="field__input" bind:value={openingBalance} inputmode="decimal" />
				</label>

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
						Peníze v téhle měně na jiné kartě nebo v hotovosti. Přičtou se k zůstatku tohohle účtu;
						výdaje z nich zapisuješ sem jako z každého jiného.
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
			karty účtu. V každé měně je jeden účet — koruny z jiné banky se k tomu korunovému přidají jako
			peníze jinde. Mezi měnami se nesčítá nic: kurz se nikde nebere.
		</p>
	</section>

	<!-- ── kategorie ─────────────────────────────────────────────────── -->
	<section class="card card--list cats" id="kategorie">
		<h2 class="label cats__label">Kategorie</h2>
		{#each visibleCategories as category (category.id)}
			{@const style = categoryStyle(category)}
			<button
				type="button"
				class="row row--short row--press"
				class:cat--archived={category.isArchived}
				onclick={() => openCategory(category)}
			>
				<span class="circle circle--sm" style="--c: {colorVar(style.color)}">
					<Icon name={style.icon} size={16} stroke={2} />
				</span>
				<span class="row__body">
					<span class="cat__name">{category.name}</span>
				</span>
				<span class="badge">{category.isIncome ? 'příjem' : TYPE_LABEL[category.spendType]}</span>
				{#if category.isArchived}
					<span class="badge">v archivu</span>
				{/if}
				<span class="card__go"><Icon name="chevron-right" size={16} /></span>
			</button>
		{/each}
		<p class="hint cats__hint">
			Ťukni na kategorii a vyber jí ikonu a barvu. Kategorie se archivují, nemažou — staré záznamy
			musí zůstat čitelné.
		</p>
		<div class="cats__foot">
			<button type="button" class="btn" onclick={() => openCategory(null)}>Nová kategorie</button>
		</div>
	</section>

	<!-- ── vzhled ────────────────────────────────────────────────────── -->
	<section class="card" id="vzhled">
		<h2 class="label">Vzhled</h2>
		<div class="seg seg--soft" role="group" aria-label="Motiv">
			{#each [{ value: 'system', label: 'systém' }, { value: 'light', label: 'světlý' }, { value: 'dark', label: 'tmavý' }] as option (option.value)}
				<button
					type="button"
					class="seg__item"
					aria-pressed={theme === option.value}
					onclick={() => chooseTheme(option.value as Theme)}
				>
					{option.label}
				</button>
			{/each}
		</div>
		<p class="hint">Tmavý na noc, jednou rukou, se zhasnutým světlem.</p>
	</section>

	<!-- ── synchronizace ─────────────────────────────────────────────── -->
	<section class="card" id="synchronizace">
		<h2 class="label">Synchronizace</h2>

		{#if sync.state === 'off'}
			<p class="hint">
				Zatím jen tenhle prohlížeč. Spáruj zařízení se serverem a záznamy se budou přenášet mezi
				telefonem a počítačem — zapisovat půjde dál i offline, fronta se odešle, až bude signál.
			</p>

			<label class="field">
				<span class="field__label">Adresa serveru</span>
				<input
					class="field__input"
					bind:value={syncBaseUrl}
					placeholder="https://prosper.example.com"
					autocomplete="off"
					inputmode="url"
				/>
			</label>

			<div class="pair">
				<label class="field">
					<span class="field__label">Párovací kód</span>
					<input
						class="field__input"
						bind:value={syncCode}
						autocomplete="off"
						inputmode="numeric"
					/>
				</label>
				<label class="field">
					<span class="field__label">Název zařízení</span>
					<input class="field__input" bind:value={syncDeviceName} placeholder="Telefon" />
				</label>
			</div>

			{#if syncError}
				<p class="error-text">{syncError}</p>
			{/if}

			<div class="actions">
				<button
					type="button"
					class="btn btn--primary pair__go"
					disabled={syncBusy || !syncBaseUrl.trim() || !syncCode.trim()}
					onclick={runPair}
				>
					{syncBusy ? 'Páruji…' : 'Spárovat'}
				</button>
			</div>
		{:else}
			<dl class="facts">
				<div>
					<dt>Stav</dt>
					<dd data-state={sync.state} class="sync-state">{SYNC_LABEL[sync.state] ?? sync.state}</dd>
				</div>
				<div>
					<dt>Čeká na odeslání</dt>
					<dd>{sync.pending}</dd>
				</div>
				<div>
					<dt>Naposledy</dt>
					<dd>{sync.lastSyncedAt ? formatDateTime(sync.lastSyncedAt) : '—'}</dd>
				</div>
			</dl>

			{#if sync.lastError}
				<p class="error-text">{sync.lastError}</p>
			{/if}

			<p class="hint">
				{sync.pending > 0
					? `${counted(sync.pending, RECORDS)} zatím jen tady. Dokud fronta nedojede na nulu, druhá kopie sešitu neexistuje.`
					: 'Fronta je prázdná — všechno je i na serveru.'}
			</p>

			<div class="actions">
				<button type="button" class="btn" onclick={() => void syncNow()}>Synchronizovat teď</button>
				<button type="button" class="btn btn--quiet" onclick={runUnpair}>Odpojit</button>
			</div>
		{/if}
	</section>

	<!-- ── data ──────────────────────────────────────────────────────── -->
	<section class="card" id="data">
		<h2 class="label">Data</h2>

		<div class="actions">
			<button type="button" class="btn" onclick={downloadBackup}>Export zálohy</button>
			<button type="button" class="btn" onclick={() => importInput?.click()}>Načíst zálohu</button>
			<button type="button" class="btn" onclick={downloadWorkbook}>Export do Excelu</button>
			<input
				bind:this={importInput}
				type="file"
				accept="application/json"
				class="visually-hidden"
				onchange={runImport}
			/>
		</div>

		<dl class="facts">
			<div>
				<dt>Záznamů</dt>
				<dd>{txnCount}</dd>
			</div>
			<div>
				<dt>Trvalé úložiště</dt>
				<dd>
					{#if persisted === null}
						—
					{:else if persisted}
						<span class="fact-ok">zapnuto</span>
					{:else}
						<button type="button" class="link" onclick={requestPersistence}>vyžádat</button>
					{/if}
				</dd>
			</div>
			<div>
				<dt>Verze schématu</dt>
				<dd>{SCHEMA_VERSION}</dd>
			</div>
			<div>
				<dt>Synchronizace</dt>
				<dd>{SYNC_LABEL[sync.state] ?? sync.state}</dd>
			</div>
		</dl>

		<p class="hint">
			<strong>Záloha</strong> je JSON pro obnovu aplikace, <strong>Excel</strong> je na čtení jinde —
			zpátky se načíst nedá. Dokud není synchronizace, žije celý sešit jen v tomhle prohlížeči.
		</p>

		<button
			type="button"
			class="btn btn--danger btn--lg btn--block"
			onclick={() => (resetOpen = true)}
		>
			Začít znovu
		</button>
		<p class="hint">
			Smaže celý sešit a nechá ti kategorie a nastavení. Zálohu si to nabídne uložit předtím.
		</p>
	</section>
</main>

<!-- ── nový účet ─────────────────────────────────────────────────────── -->
<BottomSheet open={addOpen} title="Nový účet" onclose={() => (addOpen = false)}>
	<div class="form">
		<label class="field">
			<span class="field__label">Název</span>
			<input class="field__input" bind:value={newAccountName} placeholder="Revolut" />
		</label>

		<div class="pair">
			<label class="field">
				<span class="field__label">Druh</span>
				<select class="field__input" bind:value={newAccountKind}>
					{#each ACCOUNT_KINDS as [kind, label] (kind)}
						<option value={kind}>{label}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span class="field__label">Měna</span>
				<select class="field__input" bind:value={newAccountCurrency}>
					{#each freeCurrencies as code (code)}
						<option value={code}>{code} — {currencySymbol(code)}</option>
					{/each}
				</select>
			</label>
		</div>
		<span class="field__hint"
			>Napořád — účet s historií měnu změnit nemůže. V každé měně je jeden účet.</span
		>

		<div class="pair">
			<label class="field">
				<span class="field__label">Počáteční zůstatek</span>
				<input
					class="field__input"
					bind:value={newAccountBalance}
					inputmode="decimal"
					placeholder="0"
				/>
			</label>

			<label class="field">
				<span class="field__label">Ke dni</span>
				<input class="field__input" type="date" bind:value={newAccountDate} />
			</label>
		</div>

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

<CategorySheet
	open={categorySheetOpen}
	category={editingCategory}
	oncreate={addCategory}
	onpatch={patchCategory}
	onclose={() => (categorySheetOpen = false)}
/>

<ResetSheet
	open={resetOpen}
	paired={sync.state !== 'off'}
	onbackup={downloadBackup}
	onpush={pushBeforeReset}
	onreset={runReset}
	onclose={() => (resetOpen = false)}
/>

<TabBar />

<style>
	/* ── accounts ────────────────────────────────────────────────────────── */

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

	/* ── categories ──────────────────────────────────────────────────────── */

	.cats {
		padding-top: var(--space-4);
		padding-bottom: var(--space-3);
	}

	.cats__label {
		padding-bottom: var(--space-1);
	}

	.cat__name {
		font-size: var(--text-base);
	}

	.cat--archived {
		opacity: 0.5;
	}

	.cats__hint {
		padding-top: var(--space-3);
	}

	.cats__foot {
		display: flex;
		padding-top: var(--space-3);
	}

	/* ── sync ────────────────────────────────────────────────────────────── */

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

	.pair__go {
		min-height: 44px;
		padding: 0 var(--space-5);
	}

	.sync-state[data-state='error'] {
		color: var(--danger);
	}

	.sync-state[data-state='idle'] {
		color: var(--in);
	}

	.fact-ok {
		color: var(--in);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
