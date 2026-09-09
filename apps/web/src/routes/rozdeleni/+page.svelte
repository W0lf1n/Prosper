<script lang="ts">
	/**
	 * Rozdělení příjmu — the planner (Q69).
	 *
	 * The book's instruction is that income has a shape decided *before* the
	 * month starts. `/prehled` measures the shape a month ended up with; this
	 * screen is the shape on paper: what comes in, line by line, what is
	 * committed, line by line, and what that leaves — **pro mě**, the money
	 * that is actually yours to live on. The three decisions are held against
	 * the book's 10 % each, the way a finished month is on Přehled.
	 *
	 * A line costs what it costs *you*: the mortgage is 28 000 and the
	 * roommate pays 14 000 of it back, so the line commits 14 000. The
	 * standing orders already know that (their shares), which is why a plan
	 * can start from them in one tap.
	 *
	 * A plan is saved under a name and reopened from the list at the top;
	 * `?plan=<id>` in the address is which one is open, so a reload keeps it.
	 * The draft itself lives on the page: leave without saving and it is gone,
	 * the way an unsaved sheet is.
	 */
	import { liveQuery } from 'dexie';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { createPlan, deletePlan, restorePlan, updatePlan } from '$lib/db/repo';
	import { counted, plural, type PluralForms } from '$lib/domain/czech';
	import { daysInMonth, formatShortDate, monthKey, today } from '$lib/domain/datetime';
	import { uuidv7 } from '$lib/domain/ids';
	import { ZERO, currencySymbol, formatMoney, parseAmount, type Minor } from '$lib/domain/money';
	import {
		MAX_PLAN_LINES,
		defaultPlanName,
		linesFromSchedules,
		planVerdict,
		summarisePlan
	} from '$lib/domain/plans';
	import { SPEND_TYPE_LABEL, type ProsperityClass } from '$lib/domain/prosperity';
	import type {
		Account,
		Category,
		Plan,
		PlanLine,
		PlanLineKind,
		Schedule,
		SpendType
	} from '$lib/domain/types';
	import AppBar from '$lib/ui/AppBar.svelte';
	import Explainer from '$lib/ui/Explainer.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const LINES: PluralForms = { one: 'řádek', few: 'řádky', many: 'řádků' };
	const SPEND_TYPES: SpendType[] = ['need', 'want', 'give', 'save', 'debt'];
	const CLASS_COLOUR: Record<ProsperityClass, string> = {
		give: 'var(--split-give)',
		save: 'var(--split-save)',
		debt: 'var(--split-debt)',
		live: 'var(--split-live)'
	};

	// ── what the ledger knows ───────────────────────────────────────────────
	const accounts = liveQuery(() => db().accounts.toArray());
	const categories = liveQuery(() => db().categories.toArray());
	const schedules = liveQuery(() => db().schedules.orderBy('sortOrder').toArray());
	const plans = liveQuery(async () =>
		(await db().plans.toArray()).filter((p: Plan) => !p.isDeleted)
	);

	/* Subscribed by hand and assigned into `$state`, like the rows on Přehled:
	   the list decides what opens, and must not render against the empty
	   first tick and stay there. */
	let saved = $state<Plan[]>([]);
	$effect(() => {
		const subscription = plans.subscribe((value) => {
			saved = ((value ?? []) as Plan[])
				.slice()
				.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
		});
		return () => subscription.unsubscribe();
	});

	const accountRows = $derived(($accounts ?? []) as Account[]);
	const account = $derived(accountRows.find((a) => a.id === data.accountId) ?? null);
	const currency = $derived(account?.currency ?? 'CZK');
	const symbol = $derived(currencySymbol(currency));
	const currencyOf = (plan: Plan) =>
		accountRows.find((a) => a.id === plan.accountId)?.currency ?? currency;

	const liveSchedules = $derived(
		(($schedules ?? []) as Schedule[]).filter((s) => !s.isDeleted && !s.isArchived)
	);

	const days = daysInMonth(monthKey(today()));

	// ── the draft ───────────────────────────────────────────────────────────
	interface EditorLine {
		id: string;
		kind: PlanLineKind;
		name: string;
		amountText: string;
		spendType: SpendType;
		paidBackText: string;
	}

	let planId = $state<string | null>(null);
	let name = $state('');
	let lines = $state<EditorLine[]>([]);
	/** Typed into since it was loaded or saved. */
	let dirty = $state(false);

	/** Whole koruny read better in a field than "45 000,00". Display only. */
	function fieldText(amount: Minor): string {
		if (amount === 0) return '';
		const text = formatMoney(amount, { currency: false });
		return text.endsWith(',00') ? text.slice(0, -3) : text;
	}

	function parsed(text: string): Minor {
		const result = parseAmount(text);
		return result.ok && result.value >= 0 ? result.value : ZERO;
	}

	function invalid(text: string): boolean {
		if (text.trim() === '') return false;
		const result = parseAmount(text);
		return !result.ok || result.value < 0;
	}

	function toEditor(line: PlanLine): EditorLine {
		return {
			id: line.id,
			kind: line.kind,
			name: line.name,
			amountText: fieldText(line.amount),
			spendType: line.spendType,
			paidBackText: fieldText(line.paidBack)
		};
	}

	function fromEditor(line: EditorLine): PlanLine {
		return {
			id: line.id,
			kind: line.kind,
			name: line.name,
			amount: parsed(line.amountText),
			spendType: line.spendType,
			paidBack: line.kind === 'expense' ? parsed(line.paidBackText) : ZERO
		};
	}

	const draft = $derived(lines.map(fromEditor));
	const incomes = $derived(lines.filter((l) => l.kind === 'income'));
	const expenses = $derived(lines.filter((l) => l.kind === 'expense'));
	const summary = $derived(summarisePlan({ lines: draft, days }));
	const full = $derived(lines.length >= MAX_PLAN_LINES);

	function load(plan: Plan) {
		planId = plan.id;
		name = plan.name;
		lines = plan.lines.map(toEditor);
		dirty = false;
	}

	/* The address says which plan is open. Answered once the list has
	   arrived, and only until it has been answered — a plan deleted on another
	   device is simply not there. */
	let wanted = $state<string | null>(page.url.searchParams.get('plan'));
	$effect(() => {
		if (!wanted) return;
		const plan = saved.find((p) => p.id === wanted);
		if (!plan) return;
		load(plan);
		wanted = null;
	});

	/* The address follows the open plan, without a navigation: a reload lands
	   on the same plan, and Zpět still goes to Přehled. */
	function remember(id: string | null) {
		const options = { replaceState: true, noScroll: true };
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolve()'s; only this page's own query is appended
		if (id) void goto(`${resolve('/rozdeleni')}?plan=${id}`, options);
		else void goto(resolve('/rozdeleni'), options);
	}

	function open(plan: Plan) {
		load(plan);
		remember(plan.id);
	}

	function startNew() {
		planId = null;
		name = '';
		lines = [];
		dirty = false;
		remember(null);
	}

	function edit(id: string, patch: Partial<EditorLine>) {
		lines = lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
		dirty = true;
	}

	/** "4500" becomes "4 500" on the way out of the field. */
	function tidy(id: string, field: 'amountText' | 'paidBackText') {
		const line = lines.find((l) => l.id === id);
		if (!line || invalid(line[field])) return;
		edit(id, { [field]: fieldText(parsed(line[field])) });
		dirty = true;
	}

	function addLine(kind: PlanLineKind) {
		if (full) return;
		lines = [
			...lines,
			{ id: uuidv7(), kind, name: '', amountText: '', spendType: 'need', paidBackText: '' }
		];
		dirty = true;
	}

	function removeLine(id: string) {
		lines = lines.filter((l) => l.id !== id);
		dirty = true;
	}

	function loadFromSchedules() {
		const fresh = linesFromSchedules({
			schedules: liveSchedules,
			categories: ($categories ?? []) as Category[],
			accountId: data.accountId ?? null
		});
		if (fresh.length === 0) {
			toast.show('Žádné pravidelné platby k načtení');
			return;
		}
		const room = Math.max(0, MAX_PLAN_LINES - lines.length);
		lines = [...lines, ...fresh.slice(0, room).map(toEditor)];
		dirty = true;
		toast.show(`Načteno ${counted(Math.min(fresh.length, room), LINES)} z plateb`);
	}

	// ── saving ──────────────────────────────────────────────────────────────
	let saving = $state(false);

	async function save() {
		if (!data.accountId || saving) return;
		saving = true;
		try {
			const input = { name, accountId: data.accountId, lines: draft };
			const plan = planId ? await updatePlan(planId, input) : await createPlan(input);
			if (!plan) return;
			load(plan);
			remember(plan.id);
			navigator.vibrate?.(10);
			toast.show(`„${plan.name}“ uloženo`);
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!planId) return;
		const id = planId;
		const label = name;
		await deletePlan(id);
		startNew();
		toast.show(`„${label}“ smazáno`, { undo: () => restorePlan(id) });
	}

	const living = $derived(summary.classes.find((c) => c.cls === 'live')!);
</script>

<svelte:head>
	<title>Prosper — rozdělení příjmu</title>
</svelte:head>

<main class="page">
	<AppBar title="Rozdělení příjmu" back="/prehled" />

	{#if saved.length > 0}
		<section class="card card--list">
			<div class="card__head list__head">
				<h2 class="label">Uložené plány</h2>
				{#if planId || dirty}
					<button type="button" class="btn btn--sm btn--quiet" onclick={startNew}>Nový plán</button>
				{/if}
			</div>
			{#each saved as plan (plan.id)}
				{@const s = summarisePlan({ lines: plan.lines, days })}
				<button
					type="button"
					class="row row--press row--short"
					class:row--current={plan.id === planId}
					aria-current={plan.id === planId ? 'true' : undefined}
					onclick={() => open(plan)}
				>
					<span class="row__body">
						<span class="row__title">{plan.name}</span>
						<span class="row__sub">
							{counted(plan.lines.length, LINES)} · {formatShortDate(plan.updatedAt.slice(0, 10))}
						</span>
					</span>
					<span class="row__end">
						<span class="row__amount" class:row__amount--over={s.left < 0}>
							{formatMoney(s.left, { code: currencyOf(plan) })}
						</span>
						<span class="row__note">pro mě</span>
					</span>
				</button>
			{/each}
		</section>
	{/if}

	<section class="card">
		<label class="field">
			<span class="field__label">Název plánu</span>
			<input
				class="field__input"
				value={name}
				oninput={(e) => {
					name = e.currentTarget.value;
					dirty = true;
				}}
				placeholder={defaultPlanName(today())}
				autocomplete="off"
				enterkeyhint="done"
			/>
		</label>
	</section>

	<!-- ── příjmy ─────────────────────────────────────────────────────── -->
	<section class="card lines">
		<div class="card__head">
			<h2 class="label">Příjmy</h2>
			<span class="lines__sum lines__sum--in"
				>{formatMoney(summary.income, { code: currency })}</span
			>
		</div>

		{#each incomes as line (line.id)}
			<div class="line">
				<div class="line__main">
					<input
						class="field__input line__name"
						value={line.name}
						oninput={(e) => edit(line.id, { name: e.currentTarget.value })}
						placeholder="Výplata"
						aria-label="Název příjmu"
						autocomplete="off"
					/>
					<span class="line__amount">
						<input
							class="field__input line__figure"
							value={line.amountText}
							oninput={(e) => edit(line.id, { amountText: e.currentTarget.value })}
							onblur={() => tidy(line.id, 'amountText')}
							inputmode="decimal"
							placeholder="0"
							aria-label="Částka"
							aria-invalid={invalid(line.amountText)}
							autocomplete="off"
						/>
						<span class="line__unit" aria-hidden="true">{symbol}</span>
					</span>
					<button
						type="button"
						class="btn btn--quiet line__remove"
						onclick={() => removeLine(line.id)}
						aria-label="Odebrat řádek"
					>
						<Icon name="close" size={16} stroke={2} />
					</button>
				</div>
			</div>
		{/each}

		{#if incomes.length === 0}
			<p class="hint">Výplata, brigáda, co chodí každý měsíc. Čistého.</p>
		{/if}

		<div class="lines__actions">
			<button type="button" class="btn btn--sm" onclick={() => addLine('income')} disabled={full}>
				Přidat příjem
			</button>
		</div>
	</section>

	<!-- ── výdaje ─────────────────────────────────────────────────────── -->
	<section class="card lines">
		<div class="card__head">
			<h2 class="label">
				<Explainer term="Výdaje">
					<p>
						Co je každý měsíc dané: nájem, hypotéka, energie, spoření, splátky, předplatná. Každý
						řádek má druh — stejný, jaký má kategorie — aby plán četl ve stejných čtyřech dílech
						jako hotový měsíc.
					</p>
					<p>
						<strong>Vrací mi</strong> je ta část, kterou ti někdo posílá zpátky: spolubydlící půlku hypotéky,
						kamarád třetinu Netflixu. Z účtu odejde celá částka, ale tebe stojí jen zbytek — a jen ten
						se počítá.
					</p>
				</Explainer>
			</h2>
			<span class="lines__sum">
				{formatMoney(summary.committed, { sign: 'never', code: currency })}
			</span>
		</div>

		{#each expenses as line (line.id)}
			<div class="line">
				<div class="line__main">
					<input
						class="field__input line__name"
						value={line.name}
						oninput={(e) => edit(line.id, { name: e.currentTarget.value })}
						placeholder="Nájem"
						aria-label="Název výdaje"
						autocomplete="off"
					/>
					<span class="line__amount">
						<input
							class="field__input line__figure"
							value={line.amountText}
							oninput={(e) => edit(line.id, { amountText: e.currentTarget.value })}
							onblur={() => tidy(line.id, 'amountText')}
							inputmode="decimal"
							placeholder="0"
							aria-label="Částka"
							aria-invalid={invalid(line.amountText)}
							autocomplete="off"
						/>
						<span class="line__unit" aria-hidden="true">{symbol}</span>
					</span>
					<button
						type="button"
						class="btn btn--quiet line__remove"
						onclick={() => removeLine(line.id)}
						aria-label="Odebrat řádek"
					>
						<Icon name="close" size={16} stroke={2} />
					</button>
				</div>
				<div class="line__more">
					<select
						class="field__input line__type"
						value={line.spendType}
						onchange={(e) => edit(line.id, { spendType: e.currentTarget.value as SpendType })}
						aria-label="Druh výdaje"
					>
						{#each SPEND_TYPES as type (type)}
							<option value={type}>{SPEND_TYPE_LABEL[type]}</option>
						{/each}
					</select>
					<label class="line__back">
						<span class="line__back-label">vrací mi</span>
						<span class="line__amount">
							<input
								class="field__input line__figure"
								value={line.paidBackText}
								oninput={(e) => edit(line.id, { paidBackText: e.currentTarget.value })}
								onblur={() => tidy(line.id, 'paidBackText')}
								inputmode="decimal"
								placeholder="0"
								aria-invalid={invalid(line.paidBackText)}
								autocomplete="off"
							/>
							<span class="line__unit" aria-hidden="true">{symbol}</span>
						</span>
					</label>
				</div>
			</div>
		{/each}

		{#if expenses.length === 0}
			<p class="hint">Nájem, hypotéka, energie, spoření, splátky. Co je každý měsíc dané.</p>
		{/if}

		<div class="lines__actions">
			<button type="button" class="btn btn--sm" onclick={() => addLine('expense')} disabled={full}>
				Přidat výdaj
			</button>
			{#if liveSchedules.length > 0}
				<button
					type="button"
					class="btn btn--sm btn--quiet"
					onclick={loadFromSchedules}
					disabled={full}
				>
					Načíst z pravidelných plateb
				</button>
			{/if}
		</div>
	</section>

	<!-- ── pro mě ─────────────────────────────────────────────────────── -->
	<section class="card result">
		<h2 class="label">
			<Explainer term="Pro mě">
				<p>
					Co zbude, když z příjmu odečteš všechno dané — a jen to, co tě opravdu stojí. Tohle je
					částka, ze které se žije: jídlo, doprava, radost, a co z ní ušetříš navíc.
				</p>
			</Explainer>
		</h2>
		<span class="result__big" class:result__big--over={summary.left < 0}>
			{formatMoney(summary.left, { code: currency })}
		</span>
		{#if summary.perDay}
			<span class="hint">
				To je {formatMoney(summary.perDay, { code: currency })} na den, {days}
				{plural(days, { one: 'den', few: 'dny', many: 'dní' })} v měsíci.
			</span>
		{:else if summary.left < 0}
			<span class="hint result__over">Dané výdaje jsou vyšší než příjem. Něco musí dolů.</span>
		{/if}
		<dl class="facts">
			<div>
				<dt>Přijde</dt>
				<dd>{formatMoney(summary.income, { code: currency })}</dd>
			</div>
			<div>
				<dt>Odejde</dt>
				<dd>{formatMoney(summary.gross, { code: currency })}</dd>
			</div>
			{#if summary.paidBack > 0}
				<div>
					<dt>Z toho mi vrátí ostatní</dt>
					<dd>{formatMoney(summary.paidBack, { code: currency })}</dd>
				</div>
				<div>
					<dt>Stojí mě to</dt>
					<dd>{formatMoney(summary.committed, { code: currency })}</dd>
				</div>
			{/if}
		</dl>
	</section>

	<section class="card book">
		<h2 class="label">
			<Explainer term="Podle knihy">
				<p>
					Z každé koruny příjmu: 10 % dát, 10 % odložit, 10 % na dluhy nebo rezervu, a ze zbylých 70
					% žít. Tady se proti tomu měří plán, ne hotový měsíc — každý díl říká, kolik na něj v
					plánu jde a o kolik se to liší od předlohy. Život je jen to, co je v plánu dané;
					<strong>pro mě</strong> je zbytek.
				</p>
			</Explainer>
			· 10 / 10 / 10 / 70
		</h2>
		<ul class="legend">
			{#each summary.classes as cls (cls.cls)}
				<li class="legend__row">
					<span class="legend__dot" style="background: {CLASS_COLOUR[cls.cls]}"></span>
					<span class="legend__body">
						<span class="legend__name">{cls.label}</span>
						{#if cls.cls !== 'live' && summary.hasIncome}
							<span class="legend__target"
								>kniha: {formatMoney(cls.targetAmount, { code: currency })}</span
							>
						{:else}
							<span class="legend__target">{cls.note}</span>
						{/if}
					</span>
					<span class="legend__end">
						<span class="legend__amount">{formatMoney(cls.amount, { code: currency })}</span>
						<span class="legend__pct">
							{cls.percent} %
							<span
								class="legend__delta"
								data-tone={cls.cls === 'live' || cls.delta === 0
									? 'flat'
									: cls.delta < 0
										? 'under'
										: 'over'}
							>
								{cls.cls === 'live' || cls.delta === 0
									? ''
									: `${cls.delta > 0 ? '+' : ''}${cls.delta}`}
							</span>
						</span>
					</span>
				</li>
			{/each}
		</ul>
		<p class="hint">
			{planVerdict(summary, currency)}
			{#if summary.hasIncome && summary.left > 0 && living.amount > 0}
				Na život je v plánu {formatMoney(living.amount, { code: currency })} a pro tebe zbývá
				{formatMoney(summary.left, { code: currency })}.
			{/if}
		</p>
	</section>

	<div class="actions">
		<button
			type="button"
			class="btn btn--primary btn--block"
			onclick={save}
			disabled={saving || !data.accountId}
		>
			{planId ? 'Uložit změny' : 'Uložit plán'}
		</button>
		{#if planId}
			<button type="button" class="btn btn--danger-text btn--block" onclick={remove}>
				Smazat plán
			</button>
		{/if}
	</div>
</main>

<TabBar />

<style>
	/* ── the list ────────────────────────────────────────────────────────── */

	.list__head {
		min-height: 40px;
		padding-top: 6px;
	}

	.row--current .row__title {
		color: var(--signal);
	}

	.row__amount--over {
		color: var(--danger);
	}

	/* ── the lines ───────────────────────────────────────────────────────── */

	.lines {
		gap: var(--space-3);
	}

	.lines__sum {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.lines__sum--in {
		color: var(--in);
	}

	.line {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.line + .line {
		padding-top: var(--space-3);
		border-top: 1px solid var(--hairline);
	}

	.line__main,
	.line__more {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.line__name {
		flex: 1;
		min-width: 0;
		min-height: var(--touch);
	}

	.line__amount {
		position: relative;
		flex: none;
		width: 108px;
	}

	.line__figure {
		min-height: var(--touch);
		padding-right: 34px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.line__figure[aria-invalid='true'] {
		box-shadow: 0 0 0 1.5px var(--danger);
	}

	.line__unit {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		font-size: var(--text-xs);
		color: var(--ink-3);
		pointer-events: none;
	}

	.line__remove {
		flex: none;
		width: 36px;
		min-height: var(--touch);
		padding: 0;
		color: var(--ink-3);
	}

	.line__type {
		flex: 1;
		min-width: 0;
		min-height: var(--touch);
		font-size: var(--text-sm);
	}

	.line__back {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.line__back-label {
		font-size: var(--text-xs);
		color: var(--ink-2);
		white-space: nowrap;
	}

	.lines__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* ── pro mě ──────────────────────────────────────────────────────────── */

	.result {
		gap: var(--space-2);
	}

	.result__big {
		font-size: var(--text-2xl);
		font-weight: 600;
		letter-spacing: var(--track-xl);
		font-variant-numeric: tabular-nums;
	}

	.result__big--over,
	.result__over {
		color: var(--danger);
	}

	.result .facts {
		margin-top: var(--space-2);
	}

	/* ── the book ────────────────────────────────────────────────────────── */

	.book {
		gap: 14px;
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.legend__row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 10px 0;
		border-top: 1px solid var(--hairline);
	}

	.legend__row:first-child {
		border-top: none;
		padding-top: 0;
	}

	.legend__dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
	}

	.legend__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.legend__name {
		font-size: var(--text-md);
		font-weight: 600;
	}

	.legend__target {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.legend__end {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}

	.legend__amount {
		font-size: var(--text-md);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.legend__pct {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.legend__delta[data-tone='under'] {
		color: var(--danger);
	}

	.legend__delta[data-tone='over'] {
		color: var(--in);
	}

	/* ── saving ──────────────────────────────────────────────────────────── */

	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
</style>
