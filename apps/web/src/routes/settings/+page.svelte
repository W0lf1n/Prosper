<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, SCHEMA_VERSION } from '$lib/db/schema';
	import {
		archiveCategory,
		createAccount,
		createCategory,
		createTransfer,
		exportBackup,
		importBackup,
		resetLedger,
		setActiveAccountId,
		updateAccount,
		updateCategory,
		type Backup,
		type Transfer
	} from '$lib/db/repo';
	import { invalidateAll } from '$app/navigation';
	import { ACCOUNT_KIND_LABEL, liveAccounts } from '$lib/domain/accounts';
	import {
		CURRENCIES,
		ZERO,
		currencySymbol,
		formatMoney,
		parseAmount,
		type Minor
	} from '$lib/domain/money';
	import { formatDateTime, formatShortDate, today } from '$lib/domain/datetime';
	import { summariseMonth } from '$lib/domain/checks';
	import { RECORDS, counted } from '$lib/domain/czech';
	import { KIND_LABEL } from '$lib/domain/holdings';
	import { monthlyRows, monthsCovered } from '$lib/domain/trends';
	import { sharesOf } from '$lib/domain/receivables';
	import { buildXlsx, type Sheet } from '$lib/domain/xlsx';
	import type { Account, AccountKind, Category, SpendType } from '$lib/domain/types';
	import { applyTheme, readTheme, type Theme } from '$lib/ui/theme';
	import { defaultBaseUrl, pair, unpair } from '$lib/sync/pair';
	import { initSync, syncNow, syncStatus } from '$lib/sync/status.svelte';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ResetSheet from '$lib/ui/ResetSheet.svelte';
	import BottomSheet from '$lib/ui/Sheet.svelte';
	import TransferSheet, { type TransferInput } from '$lib/ui/TransferSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const allAccounts = liveQuery(() => db().accounts.toArray());
	const accountRows = $derived(liveAccounts(($allAccounts ?? []) as Account[]));
	/**
	 * Derived from the live list rather than its own `liveQuery`: a query
	 * closing over `data.accountId` only re-runs on Dexie writes, and switching
	 * accounts writes `meta` — the fold would keep showing the old account
	 * until something else touched the table. This is the one screen a switch
	 * happens on, so it is the one screen that must re-derive.
	 */
	const account = $derived(
		(($allAccounts ?? []) as Account[]).find((a) => a.id === data.accountId) ?? null
	);
	const otherAccounts = $derived(accountRows.filter((a) => a.id !== data.accountId));
	const activeCurrency = $derived(account?.currency ?? 'CZK');
	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	/**
	 * Live rows, not every row ever written.
	 *
	 * It was `txns.count()`, which includes tombstones — so the figure never
	 * went down, and after "začít znovu" the card would have reported a
	 * thousand records against an empty tape. The scan is over one small table
	 * on a screen nobody opens in a hurry.
	 */
	const txnCount = liveQuery(() =>
		db()
			.txns.filter((t) => !t.isDeleted)
			.count()
	);

	const SPEND_TYPES: { value: SpendType; label: string }[] = [
		{ value: 'need', label: 'nutné' },
		{ value: 'want', label: 'chtěné' },
		{ value: 'give', label: 'dávání' },
		{ value: 'save', label: 'spoření' },
		{ value: 'debt', label: 'dluh' }
	];

	// ── account ─────────────────────────────────────────────────────────────
	// Writable deriveds: they seed themselves from the stored account and accept
	// typing on top, then re-seed once a save lands.
	let accountName = $derived(account?.name ?? '');
	let openingBalance = $derived(
		account ? formatMoney(account.openingBalance, { currency: false }) : ''
	);
	let openingDate = $derived(account?.openingDate ?? today());
	let accountError = $state('');

	/**
	 * Setup, not maintenance — so the card folds down to one line.
	 *
	 * Three fields typed once, and then a permanent invitation to edit the
	 * number every other figure in the app is measured from. It is not disabled
	 * outright, because a wrong opening balance is precisely what reconciling
	 * finds out three months later, and a setting nobody can reach is a bug
	 * report. It just stops shouting.
	 *
	 * `null` means "whatever the ledger says": open while there is nothing
	 * recorded, folded once there is. That is also what puts the card back on
	 * screen after "začít znovu" — the wipe removes the rows that closed it.
	 */
	let accountOpen = $state<boolean | null>(null);
	const accountExpanded = $derived(accountOpen ?? ($txnCount ?? 0) === 0);

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
		// Back to automatic: folds if there is a ledger, stays put if there is not.
		accountOpen = null;
		toast.show('Účet uložen');
	}

	/**
	 * Which account the keypad writes to — the one everything else reads (Q49).
	 * The layout hands `accountId` to every route, so a switch re-runs its load
	 * and the whole app follows.
	 */
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
		newAccountCurrency = 'CZK';
		newAccountKind = 'checking';
		newAccountDate = today();
		toast.show(`Účet „${name}“ přidán`);
	}

	/**
	 * Archiving the active account hands "active" to the next one first — the
	 * app always writes somewhere, so the last account cannot be archived at
	 * all (the button never renders without a successor).
	 */
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
	let newCategoryName = $state('');
	let newCategoryType = $state<SpendType>('want');
	let newCategoryIncome = $state(false);

	async function addCategory() {
		const name = newCategoryName.trim();
		if (!name) return;
		await createCategory({
			name,
			spendType: newCategoryType,
			isIncome: newCategoryIncome
		});
		newCategoryName = '';
		newCategoryIncome = false;
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

	/**
	 * The ledger as a spreadsheet — `PROJECT-PLAN.md` P5.
	 *
	 * The JSON backup above is for restoring the app; this is for reading the
	 * data somewhere else, which is a different job and deserves a different
	 * file. It is one-way on purpose: a spreadsheet edited by hand and imported
	 * back is precisely the loop this app was written to end.
	 *
	 * Money goes out as an exact decimal built from the integer's own digits —
	 * `domain/xlsx.ts` never divides — so a column of amounts sums in Excel to
	 * the same figure the app shows.
	 */
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
					// All shares together (Q47): the total, the names, and whether
					// everything — or only part of it — has come back.
					const shares = sharesOf(t);
					const owedTotal = shares.reduce((sum, s) => sum + s.amount, 0);
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

		// One row per bucket per month — the shape a pivot table wants, and the
		// only one that answers "what has JÍDLO done since January" without
		// rebuilding the ledger by hand.
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
			toast.show(`Načteno ${result.txns} záznamů`);
		} catch (error) {
			toast.show(error instanceof Error ? error.message : 'Zálohu se nepodařilo načíst', {
				tone: 'out'
			});
		} finally {
			input.value = '';
		}
	}

	// ── sync ────────────────────────────────────────────────────────────────
	//
	// The only screen that mentions sync at all. Everything else in the app is
	// built to work with the server permanently down, so a failed cycle belongs
	// here, in a panel somebody chose to open — never as a banner over the
	// keypad.
	const sync = syncStatus();

	// Prefilled with the origin the app was served from, because in the
	// deployment this repository describes that is the answer — client and API
	// are one nginx and one domain. A wrong address is caught by the health
	// probe in `pair()` rather than by a 404 nobody can read.
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
	//
	// The sheet owns the gate and the ordering; this owns the three things only
	// the app can do. `resetLedger` is the whole of the wipe — every rule about
	// what survives it lives in `repo.ts`, not here.
	let resetOpen = $state(false);

	/**
	 * Did everything actually reach the server?
	 *
	 * `syncNow` never throws (that is rule 5 — nothing waits on sync), so the
	 * answer has to be read off the status afterwards. An empty outbox and no
	 * error is the only reading that lets the wipe start.
	 */
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

<AppBar title="Nastavení" />

<main class="page">
	<section class="card card--account">
		<h2 class="u-label">Účty</h2>

		{#if accountExpanded}
			<label class="field">
				<span class="field__label">Název</span>
				<input class="field__input" bind:value={accountName} />
			</label>

			<label class="field">
				<span class="field__label">Počáteční zůstatek</span>
				<input
					class="field__input field__input--mono"
					bind:value={openingBalance}
					inputmode="decimal"
				/>
			</label>

			<label class="field">
				<span class="field__label">Ke dni</span>
				<input class="field__input field__input--mono" type="date" bind:value={openingDate} />
			</label>

			{#if accountError}
				<p class="error-text">{accountError}</p>
			{/if}

			<button type="button" class="btn btn--primary btn--block" onclick={saveAccount}>
				Uložit účet
			</button>

			<p class="hint prose">
				Zůstatek se počítá z počátečního stavu a všech záznamů. Zadej ho přesně tak, jak ho
				ukazovala banka k uvedenému dni — jinak nebude sedět nikdy. Měna je daná při založení ({activeCurrency})
				— účet s historií ji změnit nemůže.
			</p>

			{#if otherAccounts.length > 0}
				{#if confirmingArchive}
					<div class="archive-ask">
						<p class="archive-ask__text">
							Archivovat „{account?.name}“? Záznamy zůstanou, zapisovat se bude na „{otherAccounts[0]
								?.name}“.
						</p>
						<div class="archive-ask__actions">
							<button type="button" class="btn" onclick={() => (confirmingArchive = false)}>
								Zpět
							</button>
							<button type="button" class="btn btn--danger" onclick={archiveActive}>
								Archivovat
							</button>
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
		{:else}
			<!--
			  Folded, but it still says everything the fields would: the whole
			  point of collapsing this is that the answer stops needing checking,
			  and a summary that hides the number would not deliver that.
			-->
			<button type="button" class="summary" onclick={() => (accountOpen = true)}>
				<span class="summary__lines">
					<span class="summary__name">{account?.name ?? 'Účet'}</span>
					<span class="summary__detail">
						začal na
						<span class="mono">
							{formatMoney(account?.openingBalance ?? ZERO, { code: activeCurrency })}
						</span>
						{formatShortDate(openingDate)}
					</span>
				</span>
				<span class="summary__go">Upravit</span>
			</button>
		{/if}

		{#if otherAccounts.length > 0}
			<!-- The rest of the accounts. Tapping one makes it the account the
			     keypad writes to — the switcher lives here, next to what it
			     switches (Q49). -->
			<ul class="accounts">
				{#each otherAccounts as row (row.id)}
					<li>
						<button type="button" class="account-row" onclick={() => switchTo(row)}>
							<span class="account-row__lines">
								<span class="account-row__name">{row.name}</span>
								<span class="account-row__meta">
									{ACCOUNT_KIND_LABEL[row.kind]} · {currencySymbol(row.currency)}
								</span>
							</span>
							<span class="account-row__go">Přepnout</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="row-actions">
			<button type="button" class="btn" onclick={() => (addOpen = true)}>Přidat účet</button>
			{#if accountRows.length > 1}
				<button type="button" class="btn" onclick={() => (transferOpen = true)}>Převod</button>
			{/if}
		</div>

		<p class="hint prose">
			Klávesnice zapisuje na účet nahoře; ostatní obrazovky ukazují ten samý. Druhý účet se hodí na
			dovolenou v eurech — každý účet počítá ve své měně a dohromady se nesčítají.
		</p>
	</section>

	<section class="card">
		<h2 class="u-label">Kategorie</h2>

		<ul class="categories">
			{#each ($categories ?? []).filter((c: Category) => !c.isDeleted) as category (category.id)}
				<li class="category" class:category--archived={category.isArchived}>
					<span class="category__dot" data-type={category.spendType}></span>
					<input
						class="category__name"
						value={category.name}
						onchange={(e) => updateCategory(category.id, { name: e.currentTarget.value })}
					/>
					<select
						class="category__type"
						value={category.spendType}
						onchange={(e) =>
							updateCategory(category.id, { spendType: e.currentTarget.value as SpendType })}
					>
						{#each SPEND_TYPES as type (type.value)}
							<option value={type.value}>{type.label}</option>
						{/each}
					</select>
					{#if category.isArchived}
						<button
							type="button"
							class="category__action"
							onclick={() => updateCategory(category.id, { isArchived: false })}
							aria-label="Vrátit {category.name}"
						>
							<Icon name="plus" size={17} />
						</button>
					{:else}
						<button
							type="button"
							class="category__action"
							onclick={() => archiveCategory(category.id)}
							aria-label="Archivovat {category.name}"
						>
							<Icon name="close" size={16} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="add">
			<input
				class="field__input add__name"
				bind:value={newCategoryName}
				placeholder="Nová kategorie"
			/>
			<select class="field__input add__type" bind:value={newCategoryType}>
				{#each SPEND_TYPES as type (type.value)}
					<option value={type.value}>{type.label}</option>
				{/each}
			</select>
			<label class="checkbox">
				<input type="checkbox" bind:checked={newCategoryIncome} />
				<span>příjem</span>
			</label>
			<button type="button" class="btn add__go" onclick={addCategory}>Přidat</button>
		</div>

		<p class="hint prose">Kategorie se archivují, nemažou — staré záznamy musí zůstat čitelné.</p>
	</section>

	<section class="card">
		<h2 class="u-label">Vzhled</h2>
		<div class="segments" role="group" aria-label="Motiv">
			{#each [{ value: 'system', label: 'systém' }, { value: 'light', label: 'světlý' }, { value: 'dark', label: 'tmavý' }] as option (option.value)}
				<button
					type="button"
					class="segment"
					class:segment--on={theme === option.value}
					aria-pressed={theme === option.value}
					onclick={() => chooseTheme(option.value as Theme)}
				>
					{option.label}
				</button>
			{/each}
		</div>
		<p class="hint prose">
			Tmavý je výchozí. Tahle appka se používá jednou rukou, v posteli, se zhasnutým světlem.
		</p>
	</section>

	<!--
	  Synchronizace — P2.

	  The app is offline-first and stays that way: this panel adds a second copy
	  of the ledger, it does not become the ledger. Nothing on any other screen
	  waits for it, and a failed cycle is a line here rather than an interruption
	  anywhere else.
	-->
	<section class="card">
		<h2 class="u-label">Synchronizace</h2>

		{#if sync.state === 'off'}
			<p class="hint prose">
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

			<div class="pair-row">
				<label class="field">
					<span class="field__label">Párovací kód</span>
					<input
						class="field__input field__input--mono"
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

			<div class="row-actions">
				<button
					type="button"
					class="btn btn--primary"
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
					<dd data-state={sync.state}>{SYNC_LABEL[sync.state] ?? sync.state}</dd>
				</div>
				<div>
					<dt>Čeká na odeslání</dt>
					<dd class="mono">{sync.pending}</dd>
				</div>
				<div>
					<dt>Naposledy</dt>
					<!-- The date alone could not tell "právě teď" from "ráno", and two
					     cycles in one day is the normal case. -->
					<dd class="mono">{sync.lastSyncedAt ? formatDateTime(sync.lastSyncedAt) : '—'}</dd>
				</div>
			</dl>

			{#if sync.lastError}
				<p class="error-text">{sync.lastError}</p>
			{/if}

			<p class="hint prose">
				{sync.pending > 0
					? `${counted(sync.pending, RECORDS)} zatím jen tady. Dokud fronta nedojede na nulu, druhá kopie sešitu neexistuje.`
					: 'Fronta je prázdná — všechno je i na serveru.'}
			</p>

			<div class="row-actions">
				<button type="button" class="btn" onclick={() => void syncNow()}>Synchronizovat teď</button>
				<button type="button" class="btn btn--quiet" onclick={runUnpair}>Odpojit</button>
			</div>
		{/if}
	</section>

	<section class="card">
		<h2 class="u-label">Data</h2>

		<p class="hint prose">
			Dokud není synchronizace, žije celý sešit jen v tomhle prohlížeči. Vyexportuj si zálohu, než
			na ni budeš spoléhat. <strong>Záloha</strong> je JSON pro obnovu aplikace,
			<strong>Excel</strong> je na čtení jinde — zpátky se načíst nedá.
		</p>

		<div class="row-actions">
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
				<dd class="mono">{$txnCount ?? 0}</dd>
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
				<dd class="mono">{SCHEMA_VERSION}</dd>
			</div>
			<div>
				<dt>Synchronizace</dt>
				<dd>{SYNC_LABEL[sync.state] ?? sync.state}</dd>
			</div>
		</dl>

		<!--
		  The way out of a sešit that is not worth keeping — a month of testing
		  the app, an import that went wrong, a year that is over.

		  Last thing on the last card, under a rule, and it is the only button in
		  the app that opens onto a typed confirmation. Everything it needs to
		  say is said in the sheet: down here it is one line, so that reading the
		  Data card top to bottom never arrives at a wall of red.
		-->
		<div class="danger">
			<button type="button" class="btn btn--danger btn--block" onclick={() => (resetOpen = true)}>
				Začít znovu
			</button>
			<p class="hint prose">
				Smaže celý sešit a nechá ti kategorie a nastavení. Zálohu si to nabídne uložit předtím.
			</p>
		</div>
	</section>
</main>

<!-- ── nový účet ─────────────────────────────────────────────────────── -->
<BottomSheet open={addOpen} title="Nový účet" onclose={() => (addOpen = false)}>
	<div class="form">
		<label class="field">
			<span class="field__label">Název</span>
			<input class="field__input" bind:value={newAccountName} placeholder="Revolut" />
		</label>

		<div class="form-pair">
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
					{#each CURRENCIES as code (code)}
						<option value={code}>{code} — {currencySymbol(code)}</option>
					{/each}
				</select>
				<span class="field__hint">Napořád — účet s historií měnu změnit nemůže.</span>
			</label>
		</div>

		<div class="form-pair">
			<label class="field">
				<span class="field__label">Počáteční zůstatek</span>
				<input
					class="field__input field__input--mono"
					bind:value={newAccountBalance}
					inputmode="decimal"
					placeholder="0"
				/>
			</label>

			<label class="field">
				<span class="field__label">Ke dni</span>
				<input class="field__input field__input--mono" type="date" bind:value={newAccountDate} />
			</label>
		</div>

		{#if newAccountError}
			<p class="error-text">{newAccountError}</p>
		{/if}

		<button type="button" class="btn btn--primary btn--block" onclick={addAccount}>
			Založit účet
		</button>
	</div>
</BottomSheet>

<TransferSheet
	open={transferOpen}
	accounts={($allAccounts ?? []) as Account[]}
	defaultFromId={data.accountId}
	onsave={saveTransfer}
	onclose={() => (transferOpen = false)}
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

	/* ── categories ──────────────────────────────────────────────────────── */

	.categories {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 22rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.category {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.category--archived {
		opacity: 0.45;
	}

	/* The same five colours as the entry chips and the ring on the month screen. */
	.category__dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-3);
	}

	.category__dot[data-type='want'] {
		background: var(--flag);
	}

	.category__dot[data-type='give'] {
		background: var(--split-give);
	}

	.category__dot[data-type='save'] {
		background: var(--in);
	}

	.category__dot[data-type='debt'] {
		background: var(--split-debt);
	}

	.category__name {
		flex: 1;
		min-width: 0;
		min-height: var(--touch);
		padding-inline: var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: var(--text-md);
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.category__name:focus-visible {
		outline: none;
		border-color: var(--signal);
		background: var(--surface-2);
	}

	.category__type {
		flex: none;
		min-height: var(--touch);
		padding-inline: var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--ink-2);
		font-size: var(--text-xs);
	}

	.category__action {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--touch);
		height: var(--touch);
		border-radius: var(--radius-full);
		color: var(--ink-3);
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.category__action:active {
		background: var(--surface-2);
		color: var(--ink);
	}

	@media (hover: hover) {
		.category__action:hover {
			background: var(--surface-2);
			color: var(--ink);
		}
	}

	.add {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--hairline);
	}

	.add__name {
		flex: 1 1 9rem;
		min-width: 8rem;
	}

	.add__type {
		flex: 0 1 7rem;
	}

	.add__go {
		flex: 0 0 auto;
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
		padding-inline: var(--space-1);
		font-size: var(--text-md);
		color: var(--ink-2);
		cursor: pointer;
	}

	/* The box is 20 px to look at; the label around it is the 44 px target. */
	.checkbox input {
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--signal);
		cursor: pointer;
	}

	/* ── sync ────────────────────────────────────────────────────────────── */

	.pair-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 360px) {
		.pair-row {
			grid-template-columns: 1fr;
		}
	}

	.facts dd[data-state='error'] {
		color: var(--danger);
	}

	.facts dd[data-state='idle'] {
		color: var(--in);
	}

	/* ── theme ───────────────────────────────────────────────────────────
	   A three-position switch, built from the same parts as the direction
	   switch on the entry screen.

	   The track is the pocket, the selection is raised: `--ground-2` up to
	   `--raised`. One rule, and it steps the right way in both themes. */
	.segments {
		display: flex;
		gap: 2px;
		padding: 3px;
		background: var(--ground-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
	}

	.segment {
		flex: 1;
		min-height: var(--touch);
		border-radius: var(--radius-sm);
		font-size: var(--text-md);
		font-weight: 400;
		color: var(--ink-3);
		transition:
			background var(--dur-base) var(--ease-out),
			color var(--dur-base) var(--ease-out);
	}

	.segment--on {
		background: var(--raised);
		color: var(--ink);
		font-weight: 600;
	}

	@media (hover: hover) {
		.segment:not(.segment--on):hover {
			color: var(--ink-2);
		}
	}

	/* ── account ─────────────────────────────────────────────────────────
	   Folded, the card is a single full-bleed row. It presses by background
	   luminance rather than by scale, like every other row in the app that
	   runs edge to edge. */

	.card--account:has(.summary) {
		gap: var(--space-3);
	}

	.summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--touch);
		padding: var(--space-2) var(--space-3);
		margin-inline: calc(var(--space-3) * -1);
		width: calc(100% + var(--space-3) * 2);
		border-radius: var(--radius-md);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.summary:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.summary:hover {
			background: var(--surface-2);
		}
	}

	.summary__lines {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.summary__name {
		font-size: var(--text-md);
		color: var(--ink);
	}

	.summary__detail {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.summary__go {
		flex: none;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--signal);
	}

	/* ── the other accounts, and the sheet that adds one ─────────────────── */

	.accounts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	/* Same full-bleed row recipe as the fold above: presses by luminance. */
	.account-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--touch);
		padding: var(--space-2) var(--space-3);
		margin-inline: calc(var(--space-3) * -1);
		width: calc(100% + var(--space-3) * 2);
		border-radius: var(--radius-md);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.account-row:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.account-row:hover {
			background: var(--surface-2);
		}
	}

	.account-row__lines {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.account-row__name {
		font-size: var(--text-md);
		color: var(--ink);
	}

	.account-row__meta {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.account-row__go {
		flex: none;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--signal);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 360px) {
		.form-pair {
			grid-template-columns: 1fr;
		}
	}

	.archive-ask {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--hairline));
		border-radius: var(--radius-sm);
		background: var(--danger-wash);
	}

	.archive-ask__text {
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.archive-ask__actions {
		display: flex;
		gap: var(--space-2);
	}

	.archive-ask__actions .btn {
		flex: 1;
	}

	/* ── data ────────────────────────────────────────────────────────────── */

	.danger {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--hairline);
	}

	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.row-actions .btn {
		flex: 1 1 auto;
	}

	.facts {
		margin: 0;
		display: flex;
		flex-direction: column;
		font-size: var(--text-md);
	}

	/* Every row is 44 px, because one of them holds an action and rows that
	   change height around a single control read as a mistake. */
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

	.mono {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.fact-ok {
		color: var(--in);
	}

	/* An action inside a data row still has to be a thumb's worth to hit. */
	.link {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		padding-inline: var(--space-2);
		margin-right: calc(var(--space-2) * -1);
		border-radius: var(--radius-sm);
		color: var(--signal);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 1px;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.link:active {
		background: var(--signal-wash);
	}

	@media (hover: hover) {
		.link:hover {
			background: var(--signal-wash);
		}
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--ink-3);
		line-height: var(--leading-base);
	}
</style>
