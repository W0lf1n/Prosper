<script lang="ts" module>
	/**
	 * The date survives the save. Backfilling a day usually means entering
	 * several rows for it in a row, and the screen is left and re-entered
	 * between them now that saving returns to Domů.
	 */
	let stickyDate: string | null = null;
</script>

<script lang="ts">
	/**
	 * Zápis — the record screen. Full-screen, no tab bar, the keypad owning
	 * the bottom of the phone; ✕ returns wherever it was opened from.
	 *
	 * Everything the old entry screen did is still here — the direction, the
	 * account (Q50, the rail is the switch), the bucket rail, the date, the
	 * payee, the two rare properties, the live checks — under the amount at
	 * 56 px. On save it goes home and the toast says what was written.
	 */
	import { liveQuery } from 'dexie';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { createTxn, deleteTxn, setActiveAccountId } from '$lib/db/repo';
	import {
		EMPTY,
		display,
		isSavable,
		pressBackspace,
		pressComma,
		pressDigit,
		toMinor,
		type AmountInput
	} from '$lib/domain/amount-input';
	import { homeCurrency, liveAccounts, openingTotal } from '$lib/domain/accounts';
	import { checkDraft, type Finding } from '$lib/domain/checks';
	import { addDays, formatDayHeading, today } from '$lib/domain/datetime';
	import { balanceOf, categoryRanking, suggestPayees } from '$lib/domain/ledger';
	import { currencySymbol, formatMoney, neg, parseAmount, type Minor } from '$lib/domain/money';
	import type { Account, Category, Txn } from '$lib/domain/types';
	import CategoryPicker from '$lib/ui/CategoryPicker.svelte';
	import Explainer from '$lib/ui/Explainer.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Keypad from '$lib/ui/Keypad.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import { accountColor, colorVar } from '$lib/ui/palette';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const allAccounts = liveQuery(() => db().accounts.toArray());
	const allCategories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());
	const allTxns = liveQuery(() => db().txns.toArray());

	const accountRows = $derived(liveAccounts(($allAccounts ?? []) as Account[]));
	const activeIdx = $derived(
		Math.max(
			0,
			accountRows.findIndex((a) => a.id === data.accountId)
		)
	);
	const activeAccount = $derived(accountRows[activeIdx] ?? null);
	const currency = $derived(activeAccount?.currency ?? 'CZK');
	const home = $derived(homeCurrency(($allAccounts ?? []) as Account[]));

	const liveRows = $derived((($allTxns ?? []) as Txn[]).filter((t) => !t.isDeleted));
	const accountTxns = $derived(liveRows.filter((t) => t.accountId === data.accountId));

	const liveCategories = $derived(
		(($allCategories ?? []) as Category[]).filter((c) => !c.isDeleted && !c.isArchived)
	);

	/** Each account's balance, for the rail. */
	function balanceFor(account: Account): Minor {
		return balanceOf(
			openingTotal(account),
			liveRows.filter((t) => t.accountId === account.id)
		);
	}

	// ── entry state ─────────────────────────────────────────────────────────
	let amount = $state<AmountInput>(EMPTY);
	let direction = $state<'out' | 'in'>('out');
	let categoryId = $state<string | null>(null);
	let payee = $state('');
	let date = $state(stickyDate ?? today());
	let dateSheetOpen = $state(false);
	let isOneOff = $state(false);
	let checksExpanded = $state(false);
	let owedSheetOpen = $state(false);
	let owedInput = $state('');
	let owedBy = $state('');

	$effect(() => {
		stickyDate = date;
	});

	const owedAmount = $derived.by(() => {
		if (!owedInput.trim()) return null;
		const parsed = parseAmount(owedInput);
		return parsed.ok && parsed.value > 0 ? parsed.value : null;
	});

	const directionCategories = $derived(
		liveCategories.filter((c) => (direction === 'in' ? c.isIncome : !c.isIncome))
	);

	/** Most-used first: what is one tap away is decided by habit. */
	const rankedCategories = $derived.by(() => {
		const byId = new Map(directionCategories.map((c) => [c.id, c]));
		return categoryRanking(accountTxns, [...byId.keys()])
			.map((id) => byId.get(id)!)
			.filter(Boolean);
	});

	const payees = $derived(suggestPayees(liveRows, payee));

	const isToday = $derived(date === today());
	const hasAmount = $derived(isSavable(amount));
	const canSave = $derived(hasAmount && Boolean(data.accountId) && Boolean(categoryId));

	const recent = $derived(
		[...accountTxns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 60)
	);

	/** The app checking on him while he types. Nothing here blocks saving. */
	const findings = $derived(
		checkDraft(
			{ amount: toMinor(amount), direction, categoryId, payee, date, isOneOff },
			{ categories: liveCategories, recent }
		)
	);

	const topFinding = $derived(findings.find((f) => f.severity === 'warn') ?? findings[0] ?? null);

	// ── actions ─────────────────────────────────────────────────────────────

	/** Where ✕ goes: back, when this screen was opened from inside the app. */
	let cameFromApp = false;
	afterNavigate((nav) => {
		cameFromApp = nav.from !== null;
	});

	function close() {
		if (cameFromApp) history.back();
		else void goto(resolve('/'));
	}

	async function save() {
		if (!canSave || !data.accountId) return;

		const magnitude = toMinor(amount);
		const signed = direction === 'out' ? neg(magnitude) : magnitude;
		const bucket = liveCategories.find((c) => c.id === categoryId)?.name ?? 'bez kategorie';
		const what = payee.trim();
		const code = currency;

		const saved = await createTxn({
			accountId: data.accountId,
			amount: signed,
			date,
			categoryId,
			payee,
			isOneOff,
			shares: direction === 'out' && owedAmount ? [{ who: owedBy, amount: owedAmount }] : []
		});

		navigator.vibrate?.(direction === 'out' ? 14 : [10, 40, 14]);
		toast.money(signed, {
			message: what ? `${bucket} · ${what}` : bucket,
			code,
			undo: () => deleteTxn(saved.id)
		});
		await goto(resolve('/'));
	}

	function setDirection(next: 'out' | 'in') {
		if (direction === next) return;
		direction = next;
		/* Příjem preselects PŘÍJEM — usually the only income bucket. */
		categoryId =
			next === 'in' && liveCategories.filter((c) => c.isIncome).length === 1
				? (liveCategories.find((c) => c.isIncome)?.id ?? null)
				: null;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

		if (/^[0-9]$/.test(event.key)) amount = pressDigit(amount, event.key);
		else if (event.key === ',' || event.key === '.') amount = pressComma(amount);
		else if (event.key === 'Backspace') amount = pressBackspace(amount);
		else if (event.key === '-') setDirection('out');
		else if (event.key === '+') setDirection('in');
		else if (event.key === 'Enter') void save();
		else if (event.key === 'Escape') close();
		else return;

		event.preventDefault();
	}

	function setDate(next: string) {
		date = next;
		dateSheetOpen = false;
	}

	function applyFix(finding: Finding) {
		const fix = finding.fix;
		if (!fix) return;
		if (fix.kind === 'set-category') categoryId = fix.categoryId;
		if (fix.kind === 'mark-one-off') isOneOff = true;
		checksExpanded = false;
	}

	// ── the account rail (Q50) ──────────────────────────────────────────────
	//
	// Swipe or tap a card to select; the selected account is the one the row
	// is written to and defines the currency. Sticky, like the date: it is the
	// same meta write Settings makes, and the layout hands the new account to
	// every route.
	let rail = $state<HTMLDivElement | null>(null);
	let switching = false;
	let skipScroll = false;
	let skipTimer: ReturnType<typeof setTimeout> | undefined;
	let scrollTimer: ReturnType<typeof setTimeout> | undefined;
	let railShown = false;

	function cardStride(el: HTMLElement): number {
		const first = el.firstElementChild as HTMLElement | null;
		return (first?.offsetWidth ?? 1) + 8;
	}

	function syncRail(idx: number) {
		const el = rail;
		if (!el || !el.firstElementChild) return;
		skipScroll = true;
		clearTimeout(skipTimer);
		skipTimer = setTimeout(() => (skipScroll = false), 400);
		el.scrollTo({ left: idx * cardStride(el), behavior: railShown ? 'smooth' : 'instant' });
		railShown = true;
	}

	async function pick(idx: number) {
		const next = accountRows[idx];
		if (!next || next.id === data.accountId || switching) return;
		switching = true;
		try {
			await setActiveAccountId(next.id);
			await invalidateAll();
		} finally {
			switching = false;
		}
		navigator.vibrate?.(8);
	}

	function onRailScroll(event: Event) {
		const el = event.currentTarget as HTMLDivElement;
		clearTimeout(scrollTimer);
		scrollTimer = setTimeout(() => {
			if (skipScroll) return;
			const idx = Math.round(el.scrollLeft / cardStride(el));
			if (idx !== activeIdx) void pick(idx);
		}, 90);
	}

	$effect(() => {
		const idx = activeIdx;
		const el = rail;
		if (!el) return;
		requestAnimationFrame(() => syncRail(idx));
	});
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>Prosper — zápis</title>
</svelte:head>

<main class="screen">
	<div class="flow">
		<header class="head">
			<button type="button" class="round" onclick={close} aria-label="Zavřít">
				<Icon name="close" size={18} stroke={1.8} />
			</button>
			<div class="seg" role="group" aria-label="Směr">
				<button
					type="button"
					class="seg__item"
					aria-pressed={direction === 'out'}
					onclick={() => setDirection('out')}
				>
					Výdaj
				</button>
				<button
					type="button"
					class="seg__item"
					aria-pressed={direction === 'in'}
					onclick={() => setDirection('in')}
				>
					Příjem
				</button>
			</div>
			<span class="head__spacer"></span>
		</header>

		<div class="rail" bind:this={rail} onscroll={onRailScroll}>
			{#each accountRows as account, i (account.id)}
				<button
					type="button"
					class="acct"
					class:acct--on={i === activeIdx}
					aria-pressed={i === activeIdx}
					onclick={() => pick(i)}
				>
					<span
						class="circle circle--md"
						style="--c: {colorVar(accountColor(account.currency, home))}"
					>
						{currencySymbol(account.currency)}
					</span>
					<span class="acct__body">
						<span class="acct__name">{account.name}</span>
						<span class="acct__code">{account.currency}</span>
					</span>
					<span class="acct__balance">
						{formatMoney(balanceFor(account), { code: account.currency })}
					</span>
				</button>
			{/each}
		</div>
		{#if accountRows.length > 1}
			<div class="dots" aria-hidden="true">
				{#each accountRows as account, i (account.id)}
					<span class="dots__dot" class:dots__dot--on={i === activeIdx}></span>
				{/each}
			</div>
		{/if}

		<div class="amount" class:amount--in={direction === 'in'}>
			<span class="label">{direction === 'out' ? 'Výdaj' : 'Příjem'}</span>
			<div class="amount__line">
				<output class="amount__digits">
					<span class="visually-hidden">{direction === 'out' ? 'Výdaj' : 'Příjem'}</span>
					{display(amount)}
				</output>
				<span class="unit" aria-label={`Měna ${currencySymbol(currency)}`}>
					{currencySymbol(currency)}
				</span>
			</div>
		</div>

		<CategoryPicker
			categories={rankedCategories}
			selectedId={categoryId}
			onselect={(id) => (categoryId = id)}
		/>

		<div class="meta">
			<button
				type="button"
				class="date"
				class:date--flag={!isToday}
				onclick={() => (dateSheetOpen = true)}
			>
				{formatDayHeading(date)}
			</button>
			<input
				class="payee"
				type="text"
				list="payees"
				bind:value={payee}
				placeholder="komu / za co"
				autocomplete="off"
				enterkeyhint="done"
			/>
		</div>

		<datalist id="payees">
			{#each payees as name (name)}
				<option value={name}></option>
			{/each}
		</datalist>

		{#if direction === 'out'}
			<div class="props">
				<div class="prop">
					<button
						type="button"
						class="toggle"
						role="switch"
						aria-checked={isOneOff}
						aria-label="Mimořádný výdaj"
						onclick={() => (isOneOff = !isOneOff)}
					></button>
					<span class="prop__name" class:prop__name--on={isOneOff}>
						<Explainer term="mimořádný výdaj" title="Mimořádný výdaj">
							<p>
								Výdaj mimo běžný chod měsíce — pračka, servis auta, letenka. Ze zůstatku odejde jako
								každý jiný. Jen se nepočítá do toho, co měsíc obvykle stojí, takže ti jedna pračka
								nezkazí srovnání s ostatními měsíci.
							</p>
						</Explainer>
					</span>
				</div>
				<button type="button" class="prop prop--owed" onclick={() => (owedSheetOpen = true)}>
					{#if owedAmount === null}
						dluží mi ›
					{:else}
						<span class="prop__value">dluží mi {formatMoney(owedAmount, { code: currency })}</span>
					{/if}
				</button>
			</div>
		{/if}

		{#if topFinding}
			<div class="checks">
				<button
					type="button"
					class="checks__main"
					onclick={() => (checksExpanded = !checksExpanded)}
					aria-expanded={checksExpanded}
				>
					<span class="dot" class:dot--warn={topFinding.severity === 'warn'}></span>
					<span class="checks__title">{topFinding.title}</span>
					{#if findings.length > 1}
						<span class="checks__count">+{findings.length - 1}</span>
					{/if}
				</button>
				{#if topFinding.fix}
					<button
						type="button"
						class="btn btn--primary btn--sm checks__fix"
						onclick={() => applyFix(topFinding)}
					>
						{topFinding.fix.label}
					</button>
				{/if}
			</div>

			{#if checksExpanded}
				<ul class="checks__list">
					{#each findings as finding (finding.id)}
						<li class="checks__row">
							<span class="dot" class:dot--warn={finding.severity === 'warn'}></span>
							<div class="checks__text">
								<p class="checks__row-title">{finding.title}</p>
								<p class="hint">{finding.detail}</p>
							</div>
							{#if finding.fix}
								<button type="button" class="btn btn--sm" onclick={() => applyFix(finding)}>
									{finding.fix.label}
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>

	<div class="pad">
		<Keypad
			ondigit={(d) => (amount = pressDigit(amount, d))}
			oncomma={() => (amount = pressComma(amount))}
			onbackspace={() => (amount = pressBackspace(amount))}
			onclear={() => (amount = EMPTY)}
		/>
		<button type="button" class="btn btn--primary save" disabled={!canSave} onclick={save}>
			{hasAmount && !categoryId ? 'Vyber kategorii' : 'Uložit'}
		</button>
	</div>
</main>

<Sheet open={owedSheetOpen} title="Kolik ti vrátí" onclose={() => (owedSheetOpen = false)}>
	<div class="form">
		<p class="hint">
			Zaplatil jsi celou částku, takže celá jde ze zůstatku. Tohle si jen pamatuje, kolik se má
			vrátit — až dorazí, odškrtneš to a zapíše se příjem.
		</p>

		<label class="field">
			<span class="field__label">Částka</span>
			<input class="field__input" bind:value={owedInput} inputmode="decimal" placeholder="0" />
		</label>

		<label class="field">
			<span class="field__label">Kdo</span>
			<input class="field__input" bind:value={owedBy} placeholder="kdo ti to vrátí" />
		</label>

		{#if owedAmount !== null && owedAmount > toMinor(amount)}
			<p class="error-text">Vrátit se má víc, než kolik jsi utratil.</p>
		{/if}

		<div class="actions actions--fill">
			<button
				type="button"
				class="btn btn--lg"
				onclick={() => {
					owedInput = '';
					owedBy = '';
					owedSheetOpen = false;
				}}
			>
				Zrušit
			</button>
			<button type="button" class="btn btn--primary" onclick={() => (owedSheetOpen = false)}>
				Hotovo
			</button>
		</div>
	</div>
</Sheet>

<Sheet open={dateSheetOpen} title="Datum" onclose={() => (dateSheetOpen = false)}>
	<div class="form dates">
		{#each [0, -1, -2, -3] as offset (offset)}
			{@const value = addDays(today(), offset)}
			<button
				type="button"
				class="date-option"
				class:date-option--on={date === value}
				aria-pressed={date === value}
				onclick={() => setDate(value)}
			>
				<span>{formatDayHeading(value)}</span>
				{#if date === value}
					<Icon name="check" size={18} stroke={2.2} />
				{/if}
			</button>
		{/each}

		<label class="field date-custom">
			<span class="field__label">Jiné datum</span>
			<input
				class="field__input"
				type="date"
				value={date}
				max={today()}
				onchange={(e) => setDate(e.currentTarget.value)}
			/>
		</label>
	</div>
</Sheet>

<style>
	/**
	 * Two parts. `.pad` is pinned to the bottom and never shrinks; `.flow` is
	 * everything above it and the one thing that gives way — on a phone with
	 * the room it never scrolls, the amount absorbs the slack, and the screen
	 * is the fixed layout the design draws. On a short one it scrolls rather
	 * than pushing Uložit off the glass.
	 */
	.screen {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		padding-top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
		padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
	}

	.flow {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		padding: 0 var(--space-4);
		overflow: hidden auto;
		overscroll-behavior: contain;
	}

	.flow > * {
		flex: none;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 48px;
	}

	.head__spacer {
		width: 40px;
	}

	/* ── the account rail ────────────────────────────────────────────────── */

	.rail {
		display: flex;
		gap: var(--space-2);
		margin: var(--space-2) calc(var(--space-4) * -1) 0;
		padding: 0 var(--space-4);
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scroll-padding: 0 var(--space-4);
	}

	.acct {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: calc(100% - 40px);
		height: 64px;
		padding: 0 14px;
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--ink);
		text-align: left;
		scroll-snap-align: start;
		transition: background var(--dur-fast) var(--ease-out);
	}

	/* With one account the card takes the whole width — nothing to swipe to. */
	.acct:only-child {
		width: 100%;
	}

	.acct:active {
		background: var(--surface-2);
	}

	.acct__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.acct__name {
		font-size: var(--text-md);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.acct__code {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.acct__balance {
		flex: none;
		font-size: var(--text-md);
		font-weight: 600;
	}

	.dots {
		display: flex;
		justify-content: center;
		gap: 5px;
		margin-top: var(--space-2);
	}

	.dots__dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--hairline);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.dots__dot--on {
		background: var(--ink);
	}

	/* ── the amount ──────────────────────────────────────────────────────── */

	.amount {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-height: 80px;
		color: var(--ink);
	}

	.amount--in {
		color: var(--in);
	}

	.amount__line {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.amount__digits {
		font-size: var(--text-display);
		font-weight: 600;
		letter-spacing: var(--track-display);
		line-height: 1;
		white-space: nowrap;
	}

	/* The currency of the account being written to. Plain text: the account
	   rail above is the switch, this only says which one is live. */
	.unit {
		color: var(--ink-2);
		font-size: 1.25rem; /* 20 */
		font-weight: 500;
		letter-spacing: 0;
	}

	/* ── when and who ────────────────────────────────────────────────────── */

	.meta {
		display: flex;
		gap: var(--space-2);
	}

	.date {
		flex: none;
		height: var(--touch-lg);
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		font-size: var(--text-base);
		font-weight: 600;
		white-space: nowrap;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.date:active {
		background: var(--surface-2);
	}

	/* A date that is not today is the one thing in this row worth flagging. */
	.date--flag {
		color: var(--flag);
	}

	.payee {
		flex: 1;
		min-width: 0;
		height: var(--touch-lg);
		padding: 0 var(--space-4);
		border: none;
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		/* 16 px is a functional floor: Mobile Safari zooms a smaller field on focus. */
		font-size: 1rem;
	}

	.payee::placeholder {
		color: var(--ink-3);
	}

	.payee:focus-visible {
		outline: none;
		box-shadow: 0 0 0 1.5px var(--signal);
	}

	/* ── properties ──────────────────────────────────────────────────────── */

	.props {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 44px;
		padding: 0 var(--space-1);
	}

	.prop {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		color: var(--ink-2);
		font-size: var(--text-md);
	}

	.prop__name--on {
		color: var(--ink);
	}

	.prop--owed {
		text-align: right;
	}

	.prop__value {
		color: var(--in);
		font-weight: 600;
	}

	/* ── checks ──────────────────────────────────────────────────────────── */

	.checks {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: var(--space-1);
		padding: var(--space-2) var(--space-2) var(--space-2) 14px;
		border-radius: var(--radius-sm);
		background: var(--surface);
	}

	.checks__main {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		min-height: 32px;
		text-align: left;
	}

	.checks__title {
		flex: 1;
		min-width: 0;
		font-size: var(--text-md);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.checks__count {
		flex: none;
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.checks__fix {
		flex: none;
	}

	.checks__list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-height: 30dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.checks__row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}

	.checks__row .dot {
		margin-top: 6px;
	}

	.checks__text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.checks__row-title {
		font-size: var(--text-md);
		font-weight: 600;
	}

	/* ── the pad ─────────────────────────────────────────────────────────── */

	.pad {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4) 0;
	}

	.save {
		min-height: 52px;
		font-size: 1rem;
	}

	/* ── sheets ──────────────────────────────────────────────────────────── */

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.dates {
		gap: var(--space-2);
	}

	.date-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--touch-lg);
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		background: var(--surface-3);
		font-size: var(--text-base);
		text-align: left;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.date-option--on {
		background: var(--pill);
		color: var(--pill-ink);
		font-weight: 600;
	}

	.date-custom {
		margin-top: var(--space-2);
	}

	/* ── short screens ───────────────────────────────────────────────────── */

	@media (max-height: 700px) {
		.amount__digits {
			font-size: var(--text-hero);
			letter-spacing: var(--track-hero);
		}

		.rail {
			margin-top: var(--space-1);
		}

		.acct {
			height: 56px;
		}

		.pad {
			padding-top: var(--space-2);
		}
	}

	/* A phone on its side: the amount and its controls on one side, the pad on
	   the other, both fully on screen with the keys still at their full size. */
	@media (max-height: 560px) and (min-width: 34rem) {
		.screen {
			flex-direction: row;
			align-items: stretch;
		}

		.flow {
			flex: 1 1 auto;
			min-width: 0;
		}

		.pad {
			flex: none;
			align-self: center;
			width: min(20rem, 46%);
			padding: var(--space-2) var(--space-4) 0 0;
		}
	}
</style>
