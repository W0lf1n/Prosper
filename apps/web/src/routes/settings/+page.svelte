<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, SCHEMA_VERSION } from '$lib/db/schema';
	import {
		archiveCategory,
		archiveSchedule,
		createCategory,
		createSchedule,
		exportBackup,
		importBackup,
		updateAccount,
		updateCategory,
		updateSchedule,
		type Backup
	} from '$lib/db/repo';
	import { formatMoney, parseAmount, type Minor } from '$lib/domain/money';
	import { today } from '$lib/domain/datetime';
	import { MODE_LABEL, recurringCost, remainingPayments } from '$lib/domain/recurring';
	import { PAYMENTS, counted } from '$lib/domain/czech';
	import type { Category, Schedule, SpendType } from '$lib/domain/types';
	import { applyTheme, readTheme, type Theme } from '$lib/ui/theme';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
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

	async function removeSchedule() {
		if (!editing) return;
		const name = editing.payee;
		await archiveSchedule(editing.id);
		sheetOpen = false;
		toast.show(`„${name}" zrušeno`);
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
		link.download = `vydaje-zaloha-${today()}.json`;
		link.click();
		URL.revokeObjectURL(url);
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
	<title>Výdaje — nastavení</title>
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
			na ni budeš spoléhat.
		</p>

		<div class="row-actions">
			<button type="button" class="btn" onclick={downloadBackup}>Export zálohy</button>
			<button type="button" class="btn" onclick={() => importInput?.click()}>Načíst zálohu</button>
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
				<dd>zatím žádná (P2)</dd>
			</div>
		</dl>
	</section>
</main>

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

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		box-shadow: var(--edge), var(--elev-1);
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

	.segments {
		display: flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
	}

	.segment {
		flex: 1;
		min-height: var(--touch);
		border-radius: var(--radius-sm);
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--ink-3);
		transition:
			background var(--dur-base) var(--ease-out),
			color var(--dur-base) var(--ease-out),
			box-shadow var(--dur-base) var(--ease-out);
	}

	.segment--on {
		background: var(--surface);
		color: var(--ink);
		font-weight: 600;
		box-shadow:
			var(--edge),
			0 1px 3px rgb(0 0 0 / 16%);
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
		font-weight: 500;
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
