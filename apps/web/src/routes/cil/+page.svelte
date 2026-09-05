<script lang="ts">
	/**
	 * Targeting — the screen (PROJECT-PLAN §2.2). A detail screen off Já.
	 *
	 * Three things, in the order they matter: the why, in his own words; this
	 * month's number; the record of months.
	 */
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import {
		catchUpGoalTargets,
		contributeToGoal,
		createGoal,
		deleteGoal,
		deleteTxn,
		pinGoal,
		setMonthTarget,
		updateGoal
	} from '$lib/db/repo';
	import { capitalize, DAYS, plural } from '$lib/domain/czech';
	import {
		formatDayHeading,
		formatMonthHeading,
		monthKey,
		startOfMonth,
		today
	} from '$lib/domain/datetime';
	import { ZERO, formatMoney, parseAmount, type Minor } from '$lib/domain/money';
	import { homeCurrency, inCurrency } from '$lib/domain/accounts';
	import {
		contributions,
		defaultGoalCategory,
		goalCategoryIds,
		goalProblemText,
		goalStatus,
		monthHistory,
		paceText,
		pickPrimary,
		validateGoal,
		WHY_MIN_LENGTH,
		type GoalStatus
	} from '$lib/domain/goals';
	import type { Account, Category, Goal, MonthTarget, Txn } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const goals = liveQuery(async () =>
		(await db().goals.toArray()).filter((g: Goal) => !g.isDeleted)
	);
	const monthTargets = liveQuery(async () =>
		(await db().monthTargets.toArray()).filter((t: MonthTarget) => !t.isDeleted)
	);
	const categories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const allTxns = liveQuery(async () =>
		(await db().txns.toArray()).filter((t: Txn) => !t.isDeleted)
	);
	const accounts = liveQuery(() => db().accounts.toArray());

	const home = $derived(homeCurrency(($accounts ?? []) as Account[]));
	const goalTxns = $derived(
		inCurrency(($allTxns ?? []) as Txn[], ($accounts ?? []) as Account[], home)
	);

	const contributionAccountId = $derived.by(() => {
		const rows = ($accounts ?? []) as Account[];
		const active = rows.find((a) => a.id === data.accountId);
		if (active && active.currency === home) return active.id;
		return rows.find((a) => !a.isDeleted && !a.isArchived && a.currency === home)?.id ?? null;
	});

	const month = monthKey(today());

	const liveCategories = $derived(
		(($categories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived && !c.isIncome)
	);

	const defaultCategory = $derived(defaultGoalCategory(liveCategories));

	function writtenTarget(goalId: string): MonthTarget | null {
		return (
			(($monthTargets ?? []) as MonthTarget[]).find(
				(t) => t.goalId === goalId && t.month === month
			) ?? null
		);
	}

	const statuses = $derived(
		(($goals ?? []) as Goal[]).map((goal) =>
			goalStatus({
				goal,
				txns: goalTxns,
				categories: liveCategories,
				target: writtenTarget(goal.id),
				month,
				today: today()
			})
		)
	);

	let selectedId = $state<string | null>(null);

	const current = $derived.by(() => {
		const chosen = statuses.find((s) => s.goal.id === selectedId);
		return chosen ?? pickPrimary(statuses);
	});

	const primaryId = $derived(pickPrimary(statuses)?.goal.id ?? null);

	const history = $derived(
		current
			? monthHistory(
					current.goal,
					goalTxns,
					liveCategories,
					(($monthTargets ?? []) as MonthTarget[]).filter((t) => t.goalId === current.goal.id),
					today()
				)
			: []
	);

	// ── the form ────────────────────────────────────────────────────────────

	let formOpen = $state(false);
	let editingId = $state<string | null>(null);
	let fName = $state('');
	let fWhy = $state('');
	let fAmount = $state('');
	let fDate = $state('');
	let fCategoryId = $state<string | null>(null);
	let fSaved = $state('');

	const fParsedAmount = $derived.by(() => {
		const parsed = parseAmount(fAmount);
		return parsed.ok ? parsed.value : ZERO;
	});

	const fParsedSaved = $derived.by(() => {
		if (!fSaved.trim()) return null;
		const parsed = parseAmount(fSaved);
		return parsed.ok && parsed.value >= 0 ? parsed.value : null;
	});

	const fSavedInvalid = $derived(fSaved.trim() !== '' && fParsedSaved === null);

	const problems = $derived(
		validateGoal(
			{ name: fName, why: fWhy, targetAmount: fParsedAmount, targetDate: fDate },
			today()
		)
	);

	const saveLabel = $derived(
		problems.length === 0
			? fSavedInvalid
				? 'Oprav našetřeno'
				: editingId
					? 'Uložit změny'
					: 'Napsat cíl'
			: problems.includes('name')
				? 'Pojmenuj cíl'
				: problems.includes('why')
					? 'Napiš proč'
					: problems.includes('amount')
						? 'Zadej částku'
						: 'Zadej termín'
	);

	function openNew() {
		editingId = null;
		fName = '';
		fWhy = '';
		fAmount = '';
		fDate = '';
		fCategoryId = defaultCategory?.id ?? null;
		fSaved = '';
		formOpen = true;
	}

	function openEdit(goal: Goal) {
		editingId = goal.id;
		fName = goal.name;
		fWhy = goal.why;
		fAmount = formatMoney(goal.targetAmount, { currency: false });
		fDate = goal.targetDate;
		fCategoryId = goal.categoryId;
		const status = statuses.find((s) => s.goal.id === goal.id);
		fSaved = status ? formatMoney(status.saved, { currency: false }) : '';
		formOpen = true;
	}

	async function submitForm() {
		if (problems.length > 0 || fSavedInvalid) return;
		if (editingId) {
			const goal = (($goals ?? []) as Goal[]).find((g) => g.id === editingId);
			await updateGoal(editingId, {
				name: fName,
				why: fWhy,
				targetAmount: fParsedAmount,
				targetDate: fDate,
				categoryId: fCategoryId,
				...(fParsedSaved !== null && goal
					? {
							startAmount: (fParsedSaved -
								contributions(
									{ ...goal, categoryId: fCategoryId },
									goalTxns,
									liveCategories
								)) as Minor
						}
					: {})
			});
			toast.show('Cíl upraven');
		} else {
			const goal = await createGoal({
				name: fName,
				why: fWhy,
				targetAmount: fParsedAmount,
				targetDate: fDate,
				categoryId: fCategoryId,
				startDate: startOfMonth(today()),
				startAmount: (fParsedSaved ?? ZERO) as Minor
			});
			selectedId = goal.id;
			await catchUpGoalTargets();
			toast.show('Cíl je napsaný. Teď ho měj na očích.');
		}
		formOpen = false;
	}

	async function removeGoal(goal: Goal) {
		await deleteGoal(goal.id);
		if (selectedId === goal.id) selectedId = null;
		toast.show(`„${goal.name}“ smazán`);
	}

	// ── this month's number ─────────────────────────────────────────────────

	let targetSheetOpen = $state(false);
	let targetInput = $state('');

	function openTargetSheet(status: GoalStatus) {
		targetInput = formatMoney(status.monthTarget, { currency: false });
		targetSheetOpen = true;
	}

	async function commitTarget(status: GoalStatus, amount: Minor) {
		await setMonthTarget(status.goal.id, month, amount);
		targetSheetOpen = false;
		toast.show(`${capitalize(formatMonthHeading(`${month}-01`))}: ${formatMoney(amount)}`);
	}

	async function resetTarget(status: GoalStatus) {
		await setMonthTarget(status.goal.id, month, status.suggestedMonthly);
		targetSheetOpen = false;
		toast.show(`Zpátky na ${formatMoney(status.suggestedMonthly)}`);
	}

	async function togglePin(status: GoalStatus) {
		const next = status.goal.isPinned ? null : status.goal.id;
		await pinGoal(next);
		toast.show(next ? `„${status.goal.name}“ máš na očích` : 'Sundáno z očí');
	}

	const parsedTargetInput = $derived.by(() => {
		const parsed = parseAmount(targetInput);
		return parsed.ok && parsed.value > 0 ? parsed.value : null;
	});

	// ── putting money aside ─────────────────────────────────────────────────

	let putSheetOpen = $state(false);
	let putInput = $state('');

	const parsedPut = $derived.by(() => {
		const parsed = parseAmount(putInput);
		return parsed.ok && parsed.value > 0 ? parsed.value : null;
	});

	function openPutSheet(status: GoalStatus) {
		const suggestion = status.monthRemaining > 0 ? status.monthRemaining : status.monthTarget;
		putInput = suggestion > 0 ? formatMoney(suggestion, { currency: false }) : '';
		putSheetOpen = true;
	}

	const putCategoryId = $derived(
		current ? (goalCategoryIds(current.goal, liveCategories)[0] ?? null) : null
	);

	async function putAside() {
		if (!current || !contributionAccountId || !parsedPut || !putCategoryId) return;
		const saved = await contributeToGoal({
			goal: current.goal,
			accountId: contributionAccountId,
			amount: parsedPut,
			categoryId: putCategoryId
		});
		putSheetOpen = false;
		navigator.vibrate?.(14);
		toast.money(saved.amount, {
			message: `${current.goal.name} · odloženo`,
			undo: () => deleteTxn(saved.id)
		});
	}

	function monthsWord(count: number): string {
		if (count === 1) return 'měsíc';
		if (count >= 2 && count <= 4) return 'měsíce';
		return 'měsíců';
	}
</script>

<svelte:head>
	<title>Prosper — cíl</title>
</svelte:head>

<main class="page">
	<AppBar title="Cíl">
		{#snippet trail()}
			{#if statuses.length > 0}
				<button type="button" class="round" onclick={openNew} aria-label="Nový cíl">
					<Icon name="plus" size={20} stroke={1.9} />
				</button>
			{/if}
		{/snippet}
	</AppBar>

	{#if !current}
		<section class="card empty">
			<h2 class="empty__title">Zatím žádný cíl</h2>
			<p class="hint">
				Nenapsaný cíl je přání. Napsaný cíl má tři věci, a bez všech tří ho tahle obrazovka nepustí
				dál: <strong>proč</strong>, <strong>kolik</strong> a <strong>do kdy</strong>.
			</p>
			<p class="hint">
				Nejtěžší je to „proč“. Vezmi si na to chvilku — je to jediná část cíle, která přežije první
				špatný měsíc.
			</p>
			<button type="button" class="btn btn--primary btn--block" onclick={openNew}>Napsat cíl</button
			>
		</section>
	{:else}
		{@const status = current}

		<!-- 1. The why, first, before any number. -->
		<section class="card goal">
			<div class="goal__head">
				<h2 class="goal__name">{status.goal.name}</h2>
				<button
					type="button"
					class="pin"
					class:pin--on={status.goal.isPinned}
					aria-pressed={status.goal.isPinned}
					onclick={() => togglePin(status)}
				>
					<Icon name="eye" size={14} stroke={1.8} />
					{status.goal.isPinned ? 'na očích' : 'mít na očích'}
				</button>
			</div>

			{#if !status.goal.isPinned && status.goal.id === primaryId}
				<p class="hint">
					Zatím si žádný cíl nevybral, tak je na úvodní obrazovce tenhle — má nejbližší termín.
				</p>
			{/if}

			<blockquote class="why well">{status.goal.why}</blockquote>

			<div class="progress">
				<span class="progress__saved">{formatMoney(status.saved)}</span>
				<span class="progress__of">z {formatMoney(status.goal.targetAmount)}</span>
			</div>
			<div class="meter meter--thick">
				<span
					class="meter__fill"
					data-tone={status.isComplete ? 'done' : status.isOverdue ? 'late' : 'on'}
					style="width: {status.percent}%"
				></span>
			</div>
			<div class="progress__foot">
				<span class="progress__pct">{status.percent} %</span>
				<span>
					{#if status.isComplete}
						hotovo
					{:else if status.isOverdue}
						termín {formatDayHeading(status.goal.targetDate)} — chybí {formatMoney(
							status.remaining
						)}
					{:else}
						do {formatDayHeading(status.goal.targetDate)} · {status.monthsLeft}
						{monthsWord(status.monthsLeft)}
					{/if}
				</span>
			</div>
		</section>

		<!-- 2. This month, which is the only horizon anybody acts on. -->
		<section class="card">
			<h2 class="label">{capitalize(formatMonthHeading(`${month}-01`))}</h2>

			{#if status.isComplete}
				<p class="pace" data-pace="done">Cíl je doma. Tenhle měsíc už nic nemusí.</p>
			{:else}
				<div class="month__numbers">
					<span class="month__saved">{formatMoney(status.monthSaved)}</span>
					<span class="month__of">z {formatMoney(status.monthTarget)}</span>
				</div>
				<div class="meter meter--thick">
					<span
						class="meter__fill"
						data-tone={status.pace === 'done' ? 'done' : status.pace === 'behind' ? 'behind' : 'on'}
						style="width: {status.monthPercent}%"
					></span>
				</div>
				<p class="pace" data-pace={status.pace}>{paceText(status)}</p>

				<div class="actions actions--fill">
					<button type="button" class="btn btn--primary" onclick={() => openPutSheet(status)}>
						Odložit
						{status.monthRemaining > 0
							? formatMoney(status.monthRemaining, { currency: false })
							: ''}
					</button>
					<button type="button" class="btn btn--lg" onclick={() => openTargetSheet(status)}>
						Upravit cíl měsíce
					</button>
				</div>
			{/if}

			{#if status.isCommitted && status.pace !== 'behind' && status.daysLeftInMonth > 0 && !status.isComplete}
				<p class="hint">
					Zbývá {status.daysLeftInMonth}
					{plural(status.daysLeftInMonth, DAYS)} měsíce.
				</p>
			{/if}
		</section>

		<!-- 3. The record. A target hit four times running is a habit. -->
		{#if history.length > 0}
			<section class="card card--list history">
				<h2 class="label history__label">Měsíce</h2>
				{#each history as row (row.month)}
					<div class="row row--short">
						<span class="row__body">
							<span class="history__month">{formatMonthHeading(`${row.month}-01`)}</span>
						</span>
						<span class="history__saved">{formatMoney(row.saved, { currency: false })}</span>
						<span class="history__target">
							{row.target === null
								? 'bez cíle'
								: `/ ${formatMoney(row.target, { currency: false })}`}
						</span>
						<span
							class="mark"
							data-state={row.target === null ? 'none' : row.met ? 'met' : 'missed'}
							aria-label={row.target === null ? 'bez cíle' : row.met ? 'splněno' : 'nesplněno'}
						>
							{#if row.target === null}
								·
							{:else if row.met}
								<Icon name="check" size={14} stroke={2.6} />
							{:else}
								<Icon name="close" size={12} stroke={2.6} />
							{/if}
						</span>
					</div>
				{/each}
				<p class="hint history__note">
					Počítá se, co v daném měsíci přišlo do
					{status.goal.categoryId
						? (liveCategories.find((c) => c.id === status.goal.categoryId)?.name ?? 'kategorie')
						: 'spořicích kategorií'}. Žádné druhé účetnictví — proto se tomu dá věřit.
				</p>
			</section>
		{/if}

		<div class="actions actions--end">
			<button type="button" class="btn btn--card" onclick={() => openEdit(status.goal)}
				>Upravit cíl</button
			>
			<button type="button" class="btn btn--danger-text" onclick={() => removeGoal(status.goal)}
				>Smazat</button
			>
		</div>

		{#if statuses.length > 1}
			<section class="card card--list others">
				<h2 class="label history__label">Další cíle</h2>
				{#each statuses as other (other.goal.id)}
					{#if other.goal.id !== status.goal.id}
						<button
							type="button"
							class="row row--short row--press"
							onclick={() => (selectedId = other.goal.id)}
						>
							{#if other.goal.isPinned}
								<span class="others__pin" aria-label="na očích"
									><Icon name="eye" size={14} stroke={1.8} /></span
								>
							{/if}
							<span class="row__body">
								<span class="others__name">{other.goal.name}</span>
							</span>
							<span class="others__pct">{other.percent} %</span>
						</button>
					{/if}
				{/each}
			</section>
		{/if}
	{/if}
</main>

<TabBar />

<!-- ── the form: three required fields, and it says so ──────────────────── -->
<Sheet
	open={formOpen}
	title={editingId ? 'Upravit cíl' : 'Napsat cíl'}
	onclose={() => (formOpen = false)}
>
	<div class="form">
		<label class="field">
			<span class="field__label">Co</span>
			<input class="field__input" bind:value={fName} placeholder="Rezerva na půl roku" />
		</label>

		<label class="field">
			<span class="field__label">
				Proč
				{#if fWhy.trim().length < WHY_MIN_LENGTH}
					<span class="counter">{fWhy.trim().length}/{WHY_MIN_LENGTH}</span>
				{/if}
			</span>
			<textarea
				class="field__input field__input--area"
				bind:value={fWhy}
				rows="3"
				placeholder="Abych mohl dát výpověď, aniž bych panikařil."></textarea>
			<span class="field__hint">{goalProblemText('why')}</span>
		</label>

		<label class="field">
			<span class="field__label">Kolik</span>
			<input class="field__input" bind:value={fAmount} inputmode="decimal" placeholder="0" />
		</label>

		<label class="field">
			<span class="field__label">Do kdy</span>
			<input class="field__input" type="date" bind:value={fDate} />
		</label>

		<label class="field">
			<span class="field__label">
				{editingId ? 'Našetřeno teď' : 'Už našetřeno'}
				<span class="optional">nepovinné</span>
			</span>
			<input class="field__input" bind:value={fSaved} inputmode="decimal" placeholder="0" />
			<span class="field__hint">
				{editingId
					? 'Přepiš, když se hodnota pohnula mimo záznamy — třeba se obchod povedl líp. Záznamy v appce se počítají dál.'
					: 'Co už máš stranou, než začneš zapisovat. Další odkládání se počítá ze záznamů.'}
			</span>
		</label>

		<label class="field">
			<span class="field__label">Kam to odkládáš</span>
			<select
				class="field__input"
				value={fCategoryId ?? ''}
				onchange={(e) => (fCategoryId = e.currentTarget.value || null)}
			>
				<option value="">všechny spořicí kategorie</option>
				{#each liveCategories as category (category.id)}
					<option value={category.id}>{category.name}</option>
				{/each}
			</select>
		</label>

		<button
			type="button"
			class="btn btn--primary btn--block"
			disabled={problems.length > 0}
			onclick={submitForm}
		>
			{saveLabel}
		</button>
	</div>
</Sheet>

<!-- ── this month's number ─────────────────────────────────────────────── -->
<Sheet
	open={targetSheetOpen}
	title="Cíl na {formatMonthHeading(`${month}-01`)}"
	onclose={() => (targetSheetOpen = false)}
>
	{#if current}
		{@const status = current}
		<div class="form">
			<p class="hint">
				Výpočet říká <strong>{formatMoney(status.suggestedMonthly)}</strong> — tolik měsíc unese, aby
				to do termínu vyšlo, a tolik si app napsala sama. Přepiš to, když víš, že tenhle měsíc bude jiný:
				nižší číslo, které dodržíš, je lepší než vyšší, které nedodržíš. Podle téhle částky se měsíc pak
				odškrtne.
			</p>

			<label class="field">
				<span class="field__label">Částka</span>
				<input class="field__input" bind:value={targetInput} inputmode="decimal" placeholder="0" />
			</label>

			<button
				type="button"
				class="btn btn--primary btn--block"
				disabled={parsedTargetInput === null}
				onclick={() => parsedTargetInput && commitTarget(status, parsedTargetInput)}
			>
				Uložit
			</button>

			{#if status.monthTarget !== status.suggestedMonthly}
				<button type="button" class="btn btn--quiet" onclick={() => resetTarget(status)}>
					Zpátky na {formatMoney(status.suggestedMonthly)}
				</button>
			{/if}
		</div>
	{/if}
</Sheet>

<!-- ── put money aside ─────────────────────────────────────────────────── -->
<Sheet open={putSheetOpen} title="Odložit" onclose={() => (putSheetOpen = false)}>
	{#if current}
		<div class="form">
			{#if putCategoryId}
				<p class="hint">
					Zapíše se jako běžný výdaj do
					<strong>{liveCategories.find((c) => c.id === putCategoryId)?.name}</strong>. Ze zůstatku
					peníze odejdou — protože odešly.
				</p>

				<label class="field">
					<span class="field__label">Částka</span>
					<input class="field__input" bind:value={putInput} inputmode="decimal" placeholder="0" />
				</label>

				<button
					type="button"
					class="btn btn--primary btn--block"
					disabled={parsedPut === null || !contributionAccountId}
					onclick={putAside}
				>
					Odložit {parsedPut ? formatMoney(parsedPut) : ''}
				</button>
			{:else}
				<p class="hint">
					Nemáš žádnou spořicí kategorii. Založ ji v
					<a class="link" href={resolve('/nastaveni')}>nastavení</a> a nastav jí typ „spoření“.
				</p>
			{/if}
		</div>
	{/if}
</Sheet>

<style>
	.empty {
		gap: var(--space-3);
		padding: var(--space-5) var(--space-4);
	}

	.empty__title {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.empty .btn {
		margin-top: var(--space-2);
	}

	/* ── the goal ────────────────────────────────────────────────────────── */

	.goal__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.goal__name {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
		text-wrap: balance;
	}

	/* The pin: on, it sits on the soft surface with the eye; off, an outline. */
	.pin {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		min-height: 32px;
		padding: 0 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-full);
		color: var(--ink-2);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.pin--on {
		border-color: transparent;
		background: var(--surface-3);
		color: var(--ink);
	}

	/* The why is the goal — set into the card, in his own voice. */
	.why {
		margin: 0;
		font-size: 1rem;
		font-style: italic;
		line-height: var(--leading-base);
		color: var(--ink);
		text-wrap: pretty;
	}

	.progress {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.progress__saved {
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: var(--track-3xl);
		line-height: var(--leading-tight);
	}

	.progress__of {
		font-size: var(--text-md);
		color: var(--ink-2);
	}

	.progress__foot {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.progress__pct {
		font-weight: 600;
		color: var(--ink);
	}

	/* ── this month ──────────────────────────────────────────────────────── */

	.month__numbers {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.month__saved {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
	}

	.month__of {
		font-size: var(--text-md);
		color: var(--ink-2);
	}

	.pace {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink-2);
	}

	.pace[data-pace='behind'] {
		color: var(--flag);
	}

	.pace[data-pace='done'] {
		color: var(--in);
	}

	/* ── the record ──────────────────────────────────────────────────────── */

	.history {
		padding-top: var(--space-4);
		padding-bottom: var(--space-3);
	}

	.history__label {
		padding-bottom: var(--space-1);
	}

	.history__month {
		font-size: var(--text-base);
	}

	.history__saved {
		font-weight: 600;
	}

	.history__target {
		width: 84px;
		text-align: right;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.history__note {
		padding-top: var(--space-3);
	}

	.mark {
		display: grid;
		place-items: center;
		flex: none;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-full);
		background: var(--surface-3);
		color: var(--ink-3);
		font-weight: 600;
	}

	.mark[data-state='met'] {
		background: var(--in);
		color: var(--cat-ink);
	}

	.mark[data-state='missed'] {
		background: var(--danger);
		color: var(--cat-ink);
	}

	/* ── other goals ─────────────────────────────────────────────────────── */

	.others {
		padding-top: var(--space-4);
	}

	.others__pin {
		display: grid;
		place-items: center;
		color: var(--signal);
	}

	.others__name {
		font-size: var(--text-base);
	}

	.others__pct {
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	/* ── sheets ──────────────────────────────────────────────────────────── */

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.counter {
		color: var(--flag);
	}

	.optional {
		color: var(--ink-3);
	}
</style>
