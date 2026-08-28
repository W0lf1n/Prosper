<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, SCHEMA_VERSION } from '$lib/db/schema';
	import {
		archiveCategory,
		archiveHolding,
		archiveSchedule,
		createCategory,
		createHolding,
		createSchedule,
		exportBackup,
		importBackup,
		updateAccount,
		updateCategory,
		updateHolding,
		updateSchedule,
		type Backup
	} from '$lib/db/repo';
	import { formatMoney, parseAmount, type Minor } from '$lib/domain/money';
	import { formatShortDate, today } from '$lib/domain/datetime';
	import { MODE_LABEL, recurringCost, remainingPayments } from '$lib/domain/recurring';
	import { summariseMonth } from '$lib/domain/checks';
	import { DAYS, PAYMENTS, RECORDS, counted } from '$lib/domain/czech';
	import { KIND_LABEL } from '$lib/domain/holdings';
	import { monthlyRows, monthsCovered } from '$lib/domain/trends';
	import { buildXlsx, type Sheet } from '$lib/domain/xlsx';
	import type { Category, Holding, Schedule, SpendType } from '$lib/domain/types';
	import { applyTheme, readTheme, type Theme } from '$lib/ui/theme';
	import { defaultBaseUrl, pair, unpair } from '$lib/sync/pair';
	import { initSync, syncNow, syncStatus } from '$lib/sync/status.svelte';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import HoldingSheet, { type HoldingInput } from '$lib/ui/HoldingSheet.svelte';
	import ScheduleSheet from '$lib/ui/ScheduleSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const account = liveQuery(async () =>
		data.accountId ? ((await db().accounts.get(data.accountId)) ?? null) : null
	);
	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const txnCount = liveQuery(() => db().txns.count());
	const schedules = liveQuery(() => db().schedules.orderBy('sortOrder').toArray());

	// ── recurring payments ──────────────────────────────────────────────────
	const liveSchedules = $derived(
		(($schedules ?? []) as Schedule[]).filter((s) => !s.isDeleted && !s.isArchived)
	);
	const cost = $derived(recurringCost(liveSchedules));
	const pickable = $derived(
		(($categories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived)
	);

	let editing = $state<Schedule | null>(null);
	let sheetOpen = $state(false);

	function openSchedule(schedule: Schedule | null) {
		editing = schedule;
		sheetOpen = true;
	}

	async function saveSchedule(input: {
		payee: string;
		categoryId: string;
		amount: number;
		dayOfMonth: number;
		endMonth: string | null;
		mode: Schedule['mode'];
	}) {
		if (editing) await updateSchedule(editing.id, { ...input, amount: input.amount as Minor });
		else await createSchedule({ ...input, amount: input.amount as Minor });
		sheetOpen = false;
		toast.show(editing ? 'Uloženo' : 'Pravidelná platba přidána');
	}

	// ── holdings ────────────────────────────────────────────────────────────
	//
	// `/jmeni` adds a holding and records values against it. Everything about the
	// holding *itself* — its name, its cadence, which bucket feeds it — belongs
	// here, next to the categories it points at, and until this existed a typo in
	// a holding's name was permanent.
	const holdings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());

	const liveHoldings = $derived(
		(($holdings ?? []) as Holding[]).filter((h) => !h.isDeleted && !h.isArchived)
	);

	/** Buckets a holding may be fed from. An income category funds nothing. */
	const fundingCategories = $derived(pickable.filter((c) => !c.isIncome));

	let editingHolding = $state<Holding | null>(null);
	let holdingSheetOpen = $state(false);

	function openHolding(holding: Holding | null) {
		editingHolding = holding;
		holdingSheetOpen = true;
	}

	async function saveHolding(input: HoldingInput) {
		if (editingHolding) await updateHolding(editingHolding.id, input);
		else await createHolding(input);
		holdingSheetOpen = false;
	}

	async function removeHolding() {
		if (!editingHolding) return;
		const name = editingHolding.name;
		await archiveHolding(editingHolding.id);
		holdingSheetOpen = false;
		toast.show(`„${name}“ schováno`);
	}

	async function removeSchedule() {
		if (!editing) return;
		const name = editing.payee;
		await archiveSchedule(editing.id);
		sheetOpen = false;
		toast.show(`„${name}“ zrušeno`);
	}

	function categoryName(id: string): string {
		return (($categories ?? []) as Category[]).find((c) => c.id === id)?.name ?? '—';
	}

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
	let accountName = $derived($account?.name ?? '');
	let openingBalance = $derived(
		$account ? formatMoney($account.openingBalance, { currency: false }) : ''
	);
	let openingDate = $derived($account?.openingDate ?? today());
	let accountError = $state('');

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
		toast.show('Účet uložen');
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
				.map((t) => [
					{ date: t.date },
					nameOf(t.categoryId),
					t.payee,
					{ money: t.amount },
					cats.find((c) => c.id === t.categoryId)?.spendType ?? '',
					t.isOneOff ? 'ano' : '',
					t.owedAmount ? { money: t.owedAmount } : null,
					t.owedBy ?? '',
					t.settledByTxnId ? 'ano' : ''
				])
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
	<section class="card">
		<h2 class="u-label">Účet</h2>

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
			Zůstatek se počítá z počátečního stavu a všech záznamů. Zadej ho přesně tak, jak ho ukazovala
			banka k uvedenému dni — jinak nebude sedět nikdy.
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

	<!--
	  ── pravidelné platby ──────────────────────────────────────────

	  Under the buckets, because that is where he went looking for it — but its
	  own list, not a field on a category: Netflix and Spotify are both LIFESTYLE
	  and they are two different standing orders.

	  The year is the number this section exists for. Twelve subscriptions at a
	  few hundred a month each is a rounding error twelve times over; the same
	  twelve as one annual figure is a decision.
	-->
	<section class="card">
		<h2 class="u-label">Pravidelné platby</h2>

		{#if liveSchedules.length === 0}
			<p class="hint prose">
				Nic tu zatím není. Zapiš předplatné, hypotéku nebo pojištění a app ti je každý měsíc nabídne
				sáma — a hlavně spočítá, na kolik přijdou za rok.
			</p>
		{:else}
			<ul class="schedules">
				{#each liveSchedules as schedule (schedule.id)}
					{@const left = remainingPayments(schedule, today())}
					<li>
						<button type="button" class="schedule" onclick={() => openSchedule(schedule)}>
							<span class="schedule__head">
								<span class="schedule__name">{schedule.payee}</span>
								<span class="schedule__amount">
									{formatMoney(schedule.amount, { sign: 'never' })}
								</span>
							</span>

							<span class="schedule__foot">
								<span class="schedule__where">
									{schedule.dayOfMonth}. · {categoryName(schedule.categoryId)}
									<span class="schedule__mode" data-mode={schedule.mode}>
										{MODE_LABEL[schedule.mode]}
									</span>
								</span>

								<span class="schedule__year">
									{#if left}
										zbývá {counted(left.payments, PAYMENTS)} · {formatMoney(left.total, {
											sign: 'never'
										})}
									{:else if schedule.amount < 0}
										{formatMoney((Math.abs(schedule.amount) * 12) as Minor)} / rok
									{/if}
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>

			{#if cost.rows.length > 0}
				<dl class="standing">
					<div>
						<dt>Za měsíc</dt>
						<dd class="mono">{formatMoney(cost.monthly)}</dd>
					</div>
					<div>
						<dt>Za rok</dt>
						<dd class="mono standing__year">{formatMoney(cost.yearly)}</dd>
					</div>
				</dl>
			{/if}
		{/if}

		<div class="row-actions">
			<button type="button" class="btn" onclick={() => openSchedule(null)}>Přidat platbu</button>
		</div>

		<p class="hint prose">
			<strong>Potvrdit</strong> ti platbu v den splatnosti nabídne na úvodní obrazovce.
			<strong>Automaticky</strong> ji zapíše samo při otevření app — jen pro částky, které se nemění.
		</p>
	</section>

	<!--
	  Jmění — the holdings themselves, not their values.

	  A value is typed on `/jmeni`, where the keypad is. What a holding *is* — its
	  name, how often it is worth asking about, and which bucket feeds it — is a
	  setting, and it belongs next to the categories it points at.
	-->
	<section class="card">
		<h2 class="u-label">Jmění</h2>

		{#if liveHoldings.length === 0}
			<p class="hint prose">
				Nic tu zatím není. Investice se přidávají na obrazovce <strong>Jmění</strong>, kde se rovnou
				zapíše i první hodnota.
			</p>
		{:else}
			<ul class="schedules">
				{#each liveHoldings as holding (holding.id)}
					<li>
						<button type="button" class="schedule" onclick={() => openHolding(holding)}>
							<span class="schedule__head">
								<span class="schedule__name">
									<span class="kind-dot" data-kind={holding.kind}></span>
									{holding.name}
								</span>
								<span class="schedule__amount">{KIND_LABEL[holding.kind]}</span>
							</span>

							<span class="schedule__foot">
								<span class="schedule__where">
									připomenout po {counted(holding.reminderDays, DAYS)}
								</span>
								<span class="schedule__year">
									{holding.categoryId ? categoryName(holding.categoryId) : 'bez kategorie'}
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="row-actions">
			<button type="button" class="btn" onclick={() => openHolding(null)}>Přidat investici</button>
		</div>

		<p class="hint prose">
			Kategorie u investice říká, odkud do ní posíláš peníze — z ní app spočítá, kolik jsi vložil a
			kolik je růst. Dvě investice na jedné kategorii to spočítat nejdou, tak se u nich vklady
			neukazují.
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
					<dd>{sync.lastSyncedAt ? formatShortDate(sync.lastSyncedAt.slice(0, 10)) : '—'}</dd>
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
	</section>
</main>

<HoldingSheet
	open={holdingSheetOpen}
	holding={editingHolding}
	categories={fundingCategories}
	onsave={saveHolding}
	onarchive={editingHolding ? removeHolding : null}
	onclose={() => (holdingSheetOpen = false)}
/>

<ScheduleSheet
	open={sheetOpen}
	schedule={editing}
	categories={pickable}
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

	/* ── theme ───────────────────────────────────────────────────────────
	   A three-position switch, built from the same parts as the direction
	   switch on the entry screen. */

	/* ── recurring ────────────────────────────────────────────────── */

	.schedules {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.schedule {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		min-height: var(--touch-lg);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.schedule:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.schedule:hover {
			background: var(--surface-2);
		}
	}

	.schedule__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	/* The same colour language the holding rows on /jmeni speak, so a kind is
	   legible before its name is read. */
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

	.kind-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		margin-inline-end: var(--space-2);
		border-radius: var(--radius-full);
		background: var(--split-live);
		vertical-align: middle;
	}

	.kind-dot[data-kind='investment'] {
		background: var(--split-give);
	}

	.kind-dot[data-kind='savings'] {
		background: var(--in);
	}

	.kind-dot[data-kind='crypto'] {
		background: var(--flag);
	}

	.schedule__name {
		min-width: 0;
		font-size: var(--text-base);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.schedule__amount {
		flex: none;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-md);
		font-weight: 600;
		letter-spacing: var(--track-tight);
	}

	.schedule__foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.schedule__where {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Which way it reaches the ledger, said once and quietly. `auto` takes the
	   signal because it is the one that writes without being asked. */
	.schedule__mode {
		flex: none;
		padding: 1px var(--space-2);
		border-radius: var(--radius-full);
		background: var(--surface-3);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--ink-3);
	}

	.schedule__mode[data-mode='auto'] {
		background: var(--signal-wash);
		color: var(--in);
	}

	.schedule__year {
		flex: none;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		letter-spacing: var(--track-tight);
	}

	/* The figure the whole section is for. */
	.standing {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-3) 0 0;
		padding-top: var(--space-3);
		border-top: 1px solid var(--hairline);
	}

	.standing > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.standing dt {
		font-size: var(--text-md);
		color: var(--ink-3);
	}

	.standing dd {
		margin: 0;
		font-size: var(--text-md);
	}

	.standing__year {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--ink);
	}

	/* The track is the pocket, the selection is raised: `--ground-2` up to
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

	/* ── data ────────────────────────────────────────────────────────────── */

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
