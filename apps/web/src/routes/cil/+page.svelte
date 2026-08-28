<script lang="ts">
	/**
	 * Targeting — the screen (PROJECT-PLAN §2.2).
	 *
	 * Three things, in the order they matter:
	 *   1. The why, in his own words, at the top. It is the only part of a goal
	 *      that survives a bad month.
	 *   2. This month's number, and whether it has been *said yes to* rather than
	 *      merely calculated.
	 *   3. The record of months, because a target you hit four times running is a
	 *      different thing from one you wrote down once.
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
	import {
		formatDayHeading,
		formatMonthHeading,
		monthKey,
		startOfMonth,
		today
	} from '$lib/domain/datetime';
	import { ZERO, formatMoney, parseAmount, type Minor } from '$lib/domain/money';
	import { DAYS, plural } from '$lib/domain/czech';
	import {
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
	import type { Category, Goal, MonthTarget, Txn } from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Money from '$lib/ui/Money.svelte';
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
	const txns = liveQuery(async () =>
		data.accountId
			? (await db().txns.where('accountId').equals(data.accountId).toArray()).filter(
					(t: Txn) => !t.isDeleted
				)
			: []
	);

	const month = monthKey(today());

	const liveCategories = $derived(
		(($categories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived && !c.isIncome)
	);

	/** Where money gets put aside. The goal names one; SPOŘENÍ is the default. */
	const defaultCategory = $derived(defaultGoalCategory(liveCategories));

	/** One goal, a handful of months: a scan is cheaper than an index. */
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
				txns: $txns ?? [],
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

	/** The one the entry screen shows, so this screen can say which that is. */
	const primaryId = $derived(pickPrimary(statuses)?.goal.id ?? null);

	const history = $derived(
		current
			? monthHistory(
					current.goal,
					$txns ?? [],
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

	const fParsedAmount = $derived.by(() => {
		const parsed = parseAmount(fAmount);
		return parsed.ok ? parsed.value : ZERO;
	});

	const problems = $derived(
		validateGoal(
			{ name: fName, why: fWhy, targetAmount: fParsedAmount, targetDate: fDate },
			today()
		)
	);

	/**
	 * The refusal, shown as the button's own label.
	 *
	 * Same move as "Vyber kategorii" on the entry screen: the control says what is
	 * missing instead of accepting the tap and then complaining.
	 */
	const saveLabel = $derived(
		problems.length === 0
			? editingId
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
		formOpen = true;
	}

	function openEdit(goal: Goal) {
		editingId = goal.id;
		fName = goal.name;
		fWhy = goal.why;
		fAmount = formatMoney(goal.targetAmount, { currency: false });
		fDate = goal.targetDate;
		fCategoryId = goal.categoryId;
		formOpen = true;
	}

	async function submitForm() {
		if (problems.length > 0) return;
		if (editingId) {
			await updateGoal(editingId, {
				name: fName,
				why: fWhy,
				targetAmount: fParsedAmount,
				targetDate: fDate,
				categoryId: fCategoryId
			});
			toast.show('Cíl upraven');
		} else {
			const goal = await createGoal({
				name: fName,
				why: fWhy,
				targetAmount: fParsedAmount,
				targetDate: fDate,
				categoryId: fCategoryId,
				startDate: startOfMonth(today())
			});
			selectedId = goal.id;
			// The layout writes this month's number on launch; a goal written
			// *during* a session would otherwise sit without one until the next.
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
		toast.show(`${formatMonthHeading(`${month}-01`)}: ${formatMoney(amount)}`);
	}

	/**
	 * Back to what the arithmetic says.
	 *
	 * Not "no target this month" any more — that state stopped existing when the
	 * number started committing itself. It rewrites the suggestion over whatever
	 * was typed, which is what somebody means by undoing an override.
	 */
	async function resetTarget(status: GoalStatus) {
		await setMonthTarget(status.goal.id, month, status.suggestedMonthly);
		targetSheetOpen = false;
		toast.show(`Zpátky na ${formatMoney(status.suggestedMonthly)}`);
	}

	// ── na očích ────────────────────────────────────────────────────────────
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

	/** Which bucket the contribution lands in — the goal's, or the first save one. */
	const putCategoryId = $derived(
		current ? (goalCategoryIds(current.goal, liveCategories)[0] ?? null) : null
	);

	async function putAside() {
		if (!current || !data.accountId || !parsedPut || !putCategoryId) return;
		const saved = await contributeToGoal({
			goal: current.goal,
			accountId: data.accountId,
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

<AppBar title="Cíl">
	{#snippet trail()}
		{#if statuses.length > 0}
			<button type="button" class="bar-action" onclick={openNew} aria-label="Nový cíl">
				<Icon name="plus" size={22} stroke={2} />
			</button>
		{/if}
	{/snippet}
</AppBar>

<main class="page">
	{#if !current}
		<section class="card card--empty">
			<h2 class="empty__title">Zatím žádný cíl</h2>
			<p class="lead prose">
				Nenapsaný cíl je přání. Napsaný cíl má tři věci, a bez všech tří ho tahle obrazovka nepustí
				dál: <strong>proč</strong>, <strong>kolik</strong> a <strong>do kdy</strong>.
			</p>
			<p class="hint prose">
				Nejtěžší je to „proč“. Vezmi si na to chvilku — je to jediná část cíle, která přežije první
				špatný měsíc.
			</p>
			<button type="button" class="btn btn--primary btn--block" onclick={openNew}>
				Napsat cíl
			</button>
		</section>
	{:else}
		{@const status = current}

		<!-- 1. The why, first, before any number. -->
		<section class="card">
			<div class="goal__head">
				<h2 class="goal__name">{status.goal.name}</h2>

				<!--
				  The choice, not a label. It used to be a badge printed on
				  whichever goal had the nearest deadline — a reasonable guess and
				  the wrong answer whenever the goal you actually think about is not
				  the one expiring soonest.
				-->
				<button
					type="button"
					class="pin"
					class:pin--on={status.goal.isPinned}
					aria-pressed={status.goal.isPinned}
					onclick={() => togglePin(status)}
				>
					<Icon name="eye" size={15} stroke={1.8} />
					{status.goal.isPinned ? 'na očích' : 'mít na očích'}
				</button>
			</div>

			{#if !status.goal.isPinned && status.goal.id === primaryId}
				<p class="hint prose">
					Zatím si žádný cíl nevybral, tak je na úvodní obrazovce tenhle — má nejbližší termín.
				</p>
			{/if}

			<!-- Set apart as the thing he wrote, not as a field the app filled in. -->
			<blockquote class="why">{status.goal.why}</blockquote>

			<div class="progress">
				<div class="progress__numbers">
					<Money value={status.saved} size="2xl" bold colour={false} />
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
			</div>
		</section>

		<!-- 2. This month, which is the only horizon anybody acts on. -->
		<section class="card" class:card--flag={status.pace === 'behind'}>
			<h2 class="u-label">{formatMonthHeading(`${month}-01`)}</h2>

			{#if status.isComplete}
				<div class="month">
					<p class="month__pace" data-pace="done">Cíl je doma. Tenhle měsíc už nic nemusí.</p>
				</div>
			{:else}
				<div class="month">
					<div class="progress__numbers">
						<Money value={status.monthSaved} size="xl" bold colour={false} />
						<span class="progress__of">z {formatMoney(status.monthTarget)}</span>
					</div>
					<div class="meter meter--thick">
						<span
							class="meter__fill"
							data-tone={status.pace === 'done' ? 'done' : status.pace === 'behind' ? 'late' : 'on'}
							style="width: {status.monthPercent}%"
						></span>
					</div>
					<p class="month__pace" data-pace={status.pace}>{paceText(status)}</p>
				</div>

				<div class="row-actions">
					<button type="button" class="btn btn--primary" onclick={() => openPutSheet(status)}>
						Odložit
						{status.monthRemaining > 0 ? formatMoney(status.monthRemaining) : ''}
					</button>
					<button type="button" class="btn" onclick={() => openTargetSheet(status)}>
						Upravit cíl měsíce
					</button>
				</div>
			{/if}

			<!-- When the pace is behind, `paceText` already names the days. -->
			{#if status.isCommitted && status.pace !== 'behind' && status.daysLeftInMonth > 0 && !status.isComplete}
				<p class="hint">
					Zbývá {status.daysLeftInMonth}
					{plural(status.daysLeftInMonth, DAYS)} měsíce.
				</p>
			{/if}
		</section>

		<!-- 3. The record. A target hit four times running is a habit. -->
		{#if history.length > 0}
			<section class="card">
				<h2 class="u-label">Měsíce</h2>
				<ul class="history">
					{#each history as row (row.month)}
						<li class="history__row">
							<span class="history__month">{formatMonthHeading(`${row.month}-01`)}</span>
							<span class="history__numbers">
								<Money value={row.saved} size="base" bold colour={false} />
								<span class="history__target">
									{row.target === null ? 'bez cíle' : `/ ${formatMoney(row.target)}`}
								</span>
							</span>
							<span
								class="history__mark"
								data-state={row.target === null ? 'none' : row.met ? 'met' : 'missed'}
							>
								{#if row.target === null}
									<span class="history__dash" aria-label="bez cíle">·</span>
								{:else if row.met}
									<Icon name="check" size={15} stroke={2.6} />
								{:else}
									<Icon name="close" size={13} stroke={2.4} />
								{/if}
							</span>
						</li>
					{/each}
				</ul>
				<p class="hint prose">
					Počítá se, co v daném měsíci přišlo do
					{status.goal.categoryId
						? (liveCategories.find((c) => c.id === status.goal.categoryId)?.name ?? 'kategorie')
						: 'spořicích kategorií'}. Žádné druhé účetnictví — proto se tomu dá věřit.
				</p>
			</section>
		{/if}

		<div class="row-actions row-actions--end">
			<button type="button" class="btn" onclick={() => openEdit(status.goal)}>Upravit cíl</button>
			<button type="button" class="btn btn--quiet" onclick={() => removeGoal(status.goal)}>
				Smazat
			</button>
		</div>

		{#if statuses.length > 1}
			<section class="card">
				<h2 class="u-label">Další cíle</h2>
				<ul class="others">
					{#each statuses as other (other.goal.id)}
						{#if other.goal.id !== status.goal.id}
							<li>
								<button type="button" class="other" onclick={() => (selectedId = other.goal.id)}>
									{#if other.goal.isPinned}
										<span class="other__pin" aria-label="na očích">
											<Icon name="eye" size={14} stroke={1.8} />
										</span>
									{/if}
									<span class="other__name">{other.goal.name}</span>
									<span class="other__pct">{other.percent} %</span>
								</button>
							</li>
						{/if}
					{/each}
				</ul>
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
				<!-- The counter is a nudge towards the floor, not a score. Once the
				     floor is cleared it has nothing left to say. -->
				{#if fWhy.trim().length < WHY_MIN_LENGTH}
					<span class="field__counter">{fWhy.trim().length}/{WHY_MIN_LENGTH}</span>
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
			<input
				class="field__input field__input--mono"
				bind:value={fAmount}
				inputmode="decimal"
				placeholder="0"
			/>
		</label>

		<label class="field">
			<span class="field__label">Do kdy</span>
			<input class="field__input field__input--mono" type="date" bind:value={fDate} />
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
			<p class="hint prose">
				Výpočet říká <strong>{formatMoney(status.suggestedMonthly)}</strong> — tolik měsíc unese, aby
				to do termínu vyšlo, a tolik si app napsala sama. Přepiš to, když víš, že tenhle měsíc bude jiný:
				nižší číslo, které dodržíš, je lepší než vyšší, které nedodržíš. Podle téhle částky se měsíc pak
				odškrtne.
			</p>

			<label class="field">
				<span class="field__label">Částka</span>
				<input
					class="field__input field__input--mono"
					bind:value={targetInput}
					inputmode="decimal"
					placeholder="0"
				/>
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
				<p class="hint prose">
					Zapíše se jako běžný výdaj do
					<strong>{liveCategories.find((c) => c.id === putCategoryId)?.name}</strong>. Ze zůstatku
					peníze odejdou — protože odešly.
				</p>

				<label class="field">
					<span class="field__label">Částka</span>
					<input
						class="field__input field__input--mono"
						bind:value={putInput}
						inputmode="decimal"
						placeholder="0"
					/>
				</label>

				<button
					type="button"
					class="btn btn--primary btn--block"
					disabled={parsedPut === null || !data.accountId}
					onclick={putAside}
				>
					Odložit {parsedPut ? formatMoney(parsedPut) : ''}
				</button>
			{:else}
				<p class="hint prose">
					Nemáš žádnou spořicí kategorii. Založ ji v
					<a href={resolve('/settings')}>nastavení</a> a nastav jí typ „spoření“.
				</p>
			{/if}
		</div>
	{/if}
</Sheet>

<style>
	.bar-action {
		display: grid;
		place-items: center;
		width: var(--touch);
		height: var(--touch);
		border-radius: var(--radius-full);
		color: var(--signal);
		transition:
			background var(--dur-fast) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.bar-action:active {
		background: var(--signal-wash);
		transform: scale(0.92);
	}

	@media (hover: hover) {
		.bar-action:hover {
			background: var(--signal-wash);
		}
	}

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

	.card--flag {
		border-color: color-mix(in srgb, var(--flag) 40%, var(--hairline));
	}

	.card--empty {
		gap: var(--space-3);
		padding: var(--space-5) var(--space-4);
	}

	.empty__title {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: var(--track-tight);
		color: var(--ink);
	}

	.lead {
		font-size: var(--text-md);
		line-height: var(--leading-base);
		color: var(--ink-2);
	}

	.lead strong {
		color: var(--ink);
		font-weight: 600;
	}

	.card--empty .btn {
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
		letter-spacing: var(--track-tight);
		color: var(--ink);
		text-wrap: balance;
	}

	/**
	 * The pin. Off it is a quiet outline; on it is the signal, because "this is
	 * the one" is a selection and selection is what `--signal` means.
	 *
	 * Not a pill — `--radius-full` on a control is reserved for the primary
	 * action of a screen (§13.16), and putting money aside is that action here.
	 */
	.pin {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: none;
		min-height: var(--touch);
		padding-inline: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--ink-3);
		font-size: var(--text-2xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.pin:active {
		transform: scale(0.95);
	}

	.pin--on {
		background: var(--signal-wash);
		border-color: color-mix(in srgb, var(--signal) 45%, var(--hairline));
		color: var(--signal);
	}

	@media (hover: hover) {
		.pin:not(.pin--on):hover {
			border-color: var(--hairline-2);
			color: var(--ink-2);
		}
	}

	/**
	 * The why is the goal, so it is not styled as a field the app filled in. It
	 * is set into the slab — recessed, italic, at reading size — as the one
	 * thing on this screen he wrote himself.
	 */
	.why {
		margin: 0;
		padding: var(--space-4);
		border-radius: var(--radius-md);
		/* The why is the one thing on this screen he wrote himself: set into the
		   card, not floating on it. Recession by luminance, no inset. */
		background: var(--ground-2);
		font-size: var(--text-base);
		font-style: italic;
		line-height: var(--leading-base);
		color: var(--ink);
		text-wrap: pretty;
	}

	.progress__numbers {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-bottom: var(--space-3);
	}

	.progress__of {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	/* ── the shared meter ────────────────────────────────────────────────
	   Geometry and track live in `app.css`. This screen is the goal, so its
	   bar is thicker and its resting fill is the signal rather than ink. */

	.meter--thick {
		height: 8px;
	}

	.meter__fill {
		background: var(--signal);
	}

	.meter__fill[data-tone='done'] {
		background: var(--in);
	}

	.meter__fill[data-tone='late'] {
		background: var(--flag);
	}

	.progress__foot {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.progress__pct {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	/* ── this month ──────────────────────────────────────────────────────── */

	.hint strong {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--ink);
	}

	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.row-actions .btn {
		flex: 1 1 auto;
	}

	.row-actions--end {
		justify-content: flex-end;
		padding-inline: var(--space-1);
	}

	.row-actions--end .btn {
		flex: 0 0 auto;
	}

	.month__pace {
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.month__pace[data-pace='behind'] {
		color: var(--flag);
	}

	.month__pace[data-pace='done'] {
		color: var(--in);
	}

	/* ── the record ──────────────────────────────────────────────────────── */

	.history {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.history__row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--hairline);
	}

	.history__row:last-child {
		border-bottom: none;
	}

	.history__month {
		flex: 1;
		min-width: 0;
		font-size: var(--text-md);
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.history__numbers {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.history__target {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.history__mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-full);
		color: var(--ink-3);
	}

	.history__mark[data-state='met'] {
		background: var(--in-wash);
		color: var(--in);
	}

	.history__mark[data-state='missed'] {
		background: var(--flag-wash);
		color: var(--flag);
	}

	.history__dash {
		line-height: 1;
	}

	/* ── other goals ─────────────────────────────────────────────────────── */

	.others {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.other {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--touch);
		padding-inline: var(--space-2);
		margin-inline: calc(var(--space-2) * -1);
		border-radius: var(--radius-sm);
		font-size: var(--text-md);
		color: var(--ink-2);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.other:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.other:hover {
			background: var(--surface-2);
			color: var(--ink);
		}
	}

	.other__pin {
		display: grid;
		place-items: center;
		flex: none;
		color: var(--signal);
	}

	.other__name {
		flex: 1;
		min-width: 0;
	}

	.other__pct {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--ink-3);
		line-height: var(--leading-base);
	}

	/* ── sheets ──────────────────────────────────────────────────────────── */

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.field__counter {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--flag);
	}
</style>
