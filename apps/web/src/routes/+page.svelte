<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import { confirmScheduled, createTxn, deleteTxn, skipScheduled } from '$lib/db/repo';
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
	import { resolve } from '$app/paths';
	import { addDays, formatDayHeading, monthKey, today } from '$lib/domain/datetime';
	import {
		CURRENCY_SYMBOL,
		ZERO,
		formatMoney,
		neg,
		parseAmount,
		sub,
		type Minor
	} from '$lib/domain/money';
	import { categoryRanking, recentPayees } from '$lib/domain/ledger';
	import { checkDraft, summariseMonth, type Finding } from '$lib/domain/checks';
	import { dueGroups, type DueGroup } from '$lib/domain/recurring';
	import { readHoldings, wealthTotal } from '$lib/domain/holdings';
	import { quietStreak } from '$lib/domain/coverage';
	import { goalCategoryIds, goalStatus, pickPrimary } from '$lib/domain/goals';
	import type {
		Category,
		Goal,
		Holding,
		MonthTarget,
		Schedule,
		Txn,
		Valuation
	} from '$lib/domain/types';
	import CategoryPicker from '$lib/ui/CategoryPicker.svelte';
	import DueStrip from '$lib/ui/DueStrip.svelte';
	import Explainer from '$lib/ui/Explainer.svelte';
	import GoalStrip from '$lib/ui/GoalStrip.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Keypad from '$lib/ui/Keypad.svelte';
	import MonthTotals from '$lib/ui/MonthTotals.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import { scene } from '$lib/ui/scene.svelte';
	import { shell } from '$lib/ui/shell.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const accountId = $derived(data.accountId);

	const allCategories = liveQuery(() => db().categories.orderBy('sortOrder').toArray());

	const allTxns = liveQuery(async () =>
		data.accountId
			? (await db().txns.where('accountId').equals(data.accountId).toArray()).filter(
					(t) => !t.isDeleted
				)
			: []
	);

	const allGoals = liveQuery(async () =>
		(await db().goals.toArray()).filter((g: Goal) => !g.isDeleted)
	);

	const allMonthTargets = liveQuery(async () =>
		(await db().monthTargets.toArray()).filter((t: MonthTarget) => !t.isDeleted)
	);

	const allSchedules = liveQuery(() => db().schedules.orderBy('sortOrder').toArray());

	/**
	 * Days in a row that cost nothing — one figure, in the corner of the totals
	 * slab, and that is its whole footprint on this screen.
	 *
	 * It used to count days *recorded*, which stopped being a question anybody
	 * could get wrong on 2026-08-28: a day with nothing on it is now a day that
	 * cost nothing, so the honest version of the same badge counts the quiet
	 * ones. Either way it never reaches the primary column — the amount and the
	 * keypad own that.
	 */
	const streak = $derived(quietStreak({ txns: ($allTxns ?? []) as Txn[], today: today() }));

	const allHoldings = liveQuery(() => db().holdings.orderBy('sortOrder').toArray());
	const allValuations = liveQuery(() => db().valuations.toArray());

	/**
	 * How many readings have gone off — the whole footprint the reminder is
	 * allowed on this screen (`INVESTMENTS.md` I5).
	 *
	 * It becomes one dot on the Jmění icon. It deliberately does NOT reach the
	 * check strip below the payee field: that strip belongs to the row being
	 * typed, and mixing "your pension statement is old" into it would make the
	 * one thing this screen is for slower.
	 */
	const staleHoldings = $derived(
		wealthTotal({
			cash: ZERO,
			readings: readHoldings({
				holdings: ($allHoldings ?? []) as Holding[],
				valuations: ($allValuations ?? []) as Valuation[],
				today: today()
			})
		}).staleCount
	);

	/**
	 * Standing orders whose day has come and which have not been settled.
	 *
	 * `auto` ones were already written by the launch catch-up, so what is left
	 * here is exactly the `confirm` set — the ones whose whole point is that
	 * somebody looks at them.
	 */
	const due = $derived(
		dueGroups({ schedules: ($allSchedules ?? []) as Schedule[], today: today() }).filter(
			(group) => group.item.schedule.mode === 'confirm'
		)
	);

	// ── entry state ─────────────────────────────────────────────────────────
	let amount = $state<AmountInput>(EMPTY);
	let direction = $state<'out' | 'in'>('out');
	let categoryId = $state<string | null>(null);
	let payee = $state('');
	let date = $state(today());
	let dateSheetOpen = $state(false);
	let isOneOff = $state(false);
	let checksExpanded = $state(false);
	let owedSheetOpen = $state(false);
	let owedInput = $state('');
	let owedBy = $state('');

	/**
	 * The keypad's own height, measured rather than guessed.
	 *
	 * It is the tallest piece of fixed furniture in the app and the only one
	 * whose height is a `dvh` clamp, so nothing can know it ahead of layout.
	 * The shell turns it into the toast's stand-off — see `shell.svelte.ts`.
	 *
	 * The border box, not the content box: the slab's own hairline is part of
	 * what the confirmation has to clear.
	 */
	let padHeight = $state(0);

	$effect(() => {
		/* The pad's own bottom margin, then the gap the card rests on. The
		   safe-area inset is not in here: the toast adds it once, for itself. */
		shell.bottomInset = padHeight ? `calc(${padHeight}px + var(--space-3) + var(--space-2))` : null;
		return () => {
			shell.bottomInset = null;
		};
	});

	/** Somebody else's share of this expense. Null until it parses. */
	const owedAmount = $derived.by(() => {
		if (!owedInput.trim()) return null;
		const parsed = parseAmount(owedInput);
		return parsed.ok && parsed.value > 0 ? parsed.value : null;
	});

	const liveCategories = $derived(
		($allCategories ?? []).filter((c: Category) => !c.isDeleted && !c.isArchived)
	);

	const directionCategories = $derived(
		liveCategories.filter((c: Category) => (direction === 'in' ? c.isIncome : !c.isIncome))
	);

	/** Most-used first: what is one tap away is decided by habit, not by history. */
	const rankedCategories = $derived.by(() => {
		const byId = new Map(directionCategories.map((c: Category) => [c.id, c]));
		return categoryRanking($allTxns ?? [], [...byId.keys()])
			.map((id) => byId.get(id)!)
			.filter(Boolean);
	});

	/** How the month stands right now — the first thing on the screen. */
	const summary = $derived(
		summariseMonth({
			month: monthKey(today()),
			txns: $allTxns ?? [],
			categories: liveCategories,
			today: today()
		})
	);

	/**
	 * The Targeting law on the launch route (§2.2): the goal he is aiming at this
	 * month, on the screen he opens twenty times a week. Unwritten goals are
	 * wishes; unseen ones are not much better.
	 */
	const goalStatuses = $derived.by(() => {
		const month = monthKey(today());
		const written = ($allMonthTargets ?? []) as MonthTarget[];
		return (($allGoals ?? []) as Goal[]).map((goal) =>
			goalStatus({
				goal,
				txns: $allTxns ?? [],
				categories: liveCategories,
				target: written.find((t) => t.goalId === goal.id && t.month === month) ?? null,
				month,
				today: today()
			})
		);
	});

	const primaryGoal = $derived(pickPrimary(goalStatuses));

	const payees = $derived(recentPayees($allTxns ?? [], 12));

	const isToday = $derived(date === today());
	/** A bucket is mandatory: an uncategorised row is a hole in next month's report. */
	const hasAmount = $derived(isSavable(amount));
	const canSave = $derived(hasAmount && Boolean(accountId) && Boolean(categoryId));

	/** Newest first — the duplicate check only looks a few days back. */
	const recent = $derived(
		[...($allTxns ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 60)
	);

	/**
	 * The app checking on him, live, while he types. Nothing here blocks saving:
	 * a check that stops you recording an expense is worse than the mistake it
	 * prevents.
	 */
	const findings = $derived(
		checkDraft(
			{ amount: toMinor(amount), direction, categoryId, payee, date, isOneOff },
			{ categories: liveCategories, recent }
		)
	);

	const topFinding = $derived(findings.find((f) => f.severity === 'warn') ?? findings[0] ?? null);

	// ── actions ─────────────────────────────────────────────────────────────

	function reset() {
		amount = EMPTY;
		categoryId = null;
		payee = '';
		isOneOff = false;
		checksExpanded = false;
		owedInput = '';
		owedBy = '';
		// The date deliberately survives: backfilling a day usually means
		// entering several transactions for it in a row.
	}

	async function save() {
		if (!canSave || !accountId) return;

		const magnitude = toMinor(amount);
		const signed = direction === 'out' ? neg(magnitude) : magnitude;
		const goalBefore = goalBeforeSave();
		const saved = await createTxn({
			accountId,
			amount: signed,
			date,
			categoryId,
			payee,
			isOneOff,
			owedAmount: direction === 'out' ? owedAmount : null,
			owedBy: direction === 'out' ? owedBy : null
		});

		navigator.vibrate?.(direction === 'out' ? 14 : [10, 40, 14]);
		/* Money left, or money arrived — and the app says which before a word of
		   the confirmation has been read. */
		scene.flash(direction);

		const bucket =
			liveCategories.find((c: Category) => c.id === categoryId)?.name ?? 'bez kategorie';
		const what = payee.trim();
		toast.money(signed, {
			message: goalBefore ? goalLine(goalBefore, magnitude) : what ? `${bucket} · ${what}` : bucket,
			undo: () => deleteTxn(saved.id)
		});
		reset();
	}

	/**
	 * When the row about to be saved counts towards the goal, the confirmation
	 * says where that leaves the month. It is the cheapest possible place to put
	 * a target in front of somebody: the half-second after they moved towards it.
	 *
	 * Read *before* the write and never after. Dexie's live query may or may not
	 * have flushed by the time the toast is built, and a message that is right
	 * only when it loses that race is a message that is sometimes wrong.
	 */
	function goalBeforeSave(): { name: string; remaining: Minor } | null {
		if (!primaryGoal || direction !== 'out' || !categoryId) return null;
		if (!goalCategoryIds(primaryGoal.goal, liveCategories).includes(categoryId)) return null;
		return { name: primaryGoal.goal.name, remaining: primaryGoal.monthRemaining };
	}

	function goalLine(before: { name: string; remaining: Minor }, magnitude: Minor): string {
		const missing = sub(before.remaining, magnitude);
		if (missing <= 0) return `${before.name} · měsíc splněn`;
		return `${before.name} · chybí ${formatMoney(missing)}`;
	}

	async function confirmDue(group: DueGroup, amount: Minor | null) {
		if (!accountId) return;
		const txn = await confirmScheduled(group.item, { accountId, amount: amount ?? undefined });
		navigator.vibrate?.(12);
		scene.flash(txn.amount < 0 ? 'out' : 'in');
		toast.money(txn.amount, {
			message: group.item.schedule.payee,
			undo: () => deleteTxn(txn.id)
		});
	}

	async function skipDue(group: DueGroup) {
		await skipScheduled(group.item);
		toast.show(`„${group.item.schedule.payee}“ tenhle měsíc přeskočeno`);
	}

	function setDirection(next: 'out' | 'in') {
		if (direction === next) return;
		direction = next;
		categoryId = null;
	}

	/**
	 * The coin in front of the number. It is a two-state control with no third
	 * position to get lost in, so it toggles rather than choosing — and it
	 * answers in the hand as well as on the glass, because the thing it changes
	 * is which way several thousand crowns are about to move.
	 */
	function flipDirection() {
		setDirection(direction === 'out' ? 'in' : 'out');
		navigator.vibrate?.(8);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

		if (/^[0-9]$/.test(event.key)) amount = pressDigit(amount, event.key);
		else if (event.key === ',' || event.key === '.') amount = pressComma(amount);
		else if (event.key === 'Backspace') amount = pressBackspace(amount);
		/* The signs name the direction rather than toggling it: on a keyboard
		   there is no coin to look at, so the key has to be the answer. */
		else if (event.key === '-') setDirection('out');
		else if (event.key === '+') setDirection('in');
		else if (event.key === 'Enter') void save();
		else return;

		event.preventDefault();
	}

	function shiftDate(offset: number): string {
		return addDays(today(), offset);
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
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>Prosper</title>
</svelte:head>

<main class="entry">
	<!--
	  Everything above the pad is one scroll region.
	
	  On a tall phone it never scrolls: the amount grows into the slack and the
	  screen looks exactly as it always did. On a short one — a landscape phone,
	  a browser tab with two toolbars, the keyboard up over a 360 px Android —
	  it gives way instead of pushing the pad off the bottom of the glass.
	-->
	<div class="flow">
		<!-- A slot of its own, so the summary can move in the flow's order without
		     the screen having to reach inside the component to do it. -->
		<div class="totals-slot">
			<MonthTotals
				month={summary.month}
				income={summary.income}
				outflow={summary.outflow}
				net={summary.net}
				href={resolve('/mesic')}
				{streak}
			>
				{#snippet actions()}
					<a class="icon-link" href={resolve('/tape')} aria-label="Výpis">
						<Icon name="tape" size={20} />
					</a>
					<!--
					  Jmění is the one stock figure in the app and it is not a tab — the
					  bar at the bottom is the four things done repeatedly. Here it costs
					  no height at all on the screen that has none to spare, and it is one
					  tap from launch.
					-->
					<a
						class="icon-link"
						href={resolve('/jmeni')}
						aria-label={staleHoldings > 0 ? 'Jmění — hodnota je stará' : 'Jmění'}
					>
						<Icon name="wealth" size={20} />
						<!--
						  A dot, and nothing else. No text, no count, no interruption: the
						  entry screen's job is a five-second transaction, and a nag about a
						  pension statement while a number is half-typed is precisely the
						  friction that killed the spreadsheet. The month view says it in
						  words; here it only has to be noticeable.
						-->
						{#if staleHoldings > 0}
							<span class="icon-link__flag" aria-hidden="true"></span>
						{/if}
					</a>
					<!--
					  Pravidelné platby. It is a tab like the others, but the entry screen
					  is the one place with no tab bar — the keypad owns the bottom of the
					  phone — so the corner is where its destinations live.
					-->
					<a class="icon-link" href={resolve('/platby')} aria-label="Pravidelné platby">
						<Icon name="repeat" size={20} />
					</a>
					<a class="icon-link" href={resolve('/settings')} aria-label="Nastavení">
						<Icon name="settings" size={20} />
					</a>
				{/snippet}

				{#snippet footer()}
					<GoalStrip status={primaryGoal} />
				{/snippet}
			</MonthTotals>
		</div>

		<!--
		  What the standing orders are waiting on. Renders nothing at all when
		  nothing is due, so the screen the five-second budget belongs to keeps
		  exactly the height it always had.
		-->
		<DueStrip groups={due} onconfirm={confirmDue} onskip={skipDue} />

		<!--
		  ── the amount, and the sign that turned into a switch ────────────

		  Direction used to be a labelled two-position track sitting a hundred
		  and seventy pixels below the number it described — a control whose
		  entire output was already legible in the sign, the colour of the
		  digits and the colour of the light behind them. Three codings and a
		  fourth row of chrome to set them.

		  So the sign became the control. The coin is where the minus was, it
		  carries the same arrow the confirmation does, and pressing it turns
		  that arrow over: down for money leaving, up for money arriving. The
		  panel below lost a row, the amount got the room, and the one decision
		  that reloads everything underneath now lives on the thing it changes.
		-->
		<div class="display" class:display--in={direction === 'in'}>
			<button
				type="button"
				class="coin"
				class:coin--in={direction === 'in'}
				onclick={flipDirection}
				aria-label={direction === 'out'
					? 'Výdaj — přepnout na příjem'
					: 'Příjem — přepnout na výdaj'}
			>
				<span class="coin__glyph"><Icon name="arrow-down" size={23} stroke={2.1} /></span>
			</button>

			<output class="display__amount" class:display__amount--in={direction === 'in'}>
				<span class="visually-hidden">{direction === 'out' ? 'Výdaj' : 'Příjem'}</span
				>{#key display(amount)}<span class="display__digits">{display(amount)}</span>{/key}
			</output>
			<span class="display__currency">{CURRENCY_SYMBOL}</span>
		</div>

		<!--
		  ── the transaction context ───────────────────────────────────────

		  Everything that labels the number above it, in one panel and in the
		  order the entry is actually made: which bucket it came out of, when
		  and to whom, and last the two rare properties. Direction is not here
		  — it went where its answer already was, onto the amount itself.

		  Each row is a different shape and a different material: a rail of
		  raised tablets, a sunken field with a slab in it, and two bare
		  properties under a score line. That is what makes the panel readable
		  at a squint — not three boxes.
		-->
		<section class="context" aria-label="Podrobnosti transakce">
			<CategoryPicker
				categories={rankedCategories}
				selectedId={categoryId}
				onselect={(id) => (categoryId = id)}
			/>

			<!-- When and who: one enclosure, two affordances. The date is a slab
			     you press, the payee is a well you type into. -->
			<div class="meta">
				<button
					type="button"
					class="meta__date"
					class:meta__date--flag={!isToday}
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

			{#if direction === 'out'}
				<!-- Rare switches. Properties of the row, not commands. -->
				<div class="extras">
					<!--
					  Two controls in one row (restored at Petr's ask, 2026-08-29): the
					  term is a vysvětlivka and the switch is the switch. The dashed
					  underline is what marks the difference before the first tap.
					-->
					<div class="prop" class:prop--on={isOneOff}>
						<span class="prop__name">
							<Explainer term="mimořádný výdaj" title="Mimořádný výdaj">
								<p>
									Výdaj mimo běžný chod měsíce — pračka, servis auta, letenka. Ze zůstatku odejde
									jako každý jiný. Jen se nepočítá do toho, co měsíc obvykle stojí, takže ti jedna
									pračka nezkazí srovnání s ostatními měsíci.
								</p>
							</Explainer>
						</span>
						<button
							type="button"
							class="prop__flip"
							role="switch"
							aria-checked={isOneOff}
							aria-label="Mimořádný výdaj"
							onclick={() => (isOneOff = !isOneOff)}
						>
							<span class="prop__track" aria-hidden="true"><span class="prop__knob"></span></span>
						</button>
					</div>

					<button
						type="button"
						class="prop prop--field"
						class:prop--owed={owedAmount !== null}
						onclick={() => (owedSheetOpen = true)}
					>
						<span class="prop__name">dluží mi</span>
						{#if owedAmount === null}
							<span class="prop__more" aria-hidden="true"
								><Icon name="chevron-right" size={15} /></span
							>
						{:else}
							<span class="prop__value">{formatMoney(owedAmount)}</span>
						{/if}
					</button>
				</div>
			{/if}
		</section>

		<datalist id="payees">
			{#each payees as name (name)}
				<option value={name}></option>
			{/each}
		</datalist>

		{#if topFinding}
			<div class="checks" class:checks--warn={topFinding.severity === 'warn'}>
				<button
					type="button"
					class="checks__main"
					onclick={() => (checksExpanded = !checksExpanded)}
					aria-expanded={checksExpanded}
				>
					<span class="checks__dot" data-severity={topFinding.severity}></span>
					<span class="checks__title">{topFinding.title}</span>
					{#if findings.length > 1}
						<span class="checks__count">+{findings.length - 1}</span>
					{/if}
				</button>

				{#if topFinding.fix}
					<button type="button" class="checks__fix" onclick={() => applyFix(topFinding)}>
						{topFinding.fix.label}
					</button>
				{/if}
			</div>

			{#if checksExpanded}
				<ul class="checks__list">
					{#each findings as finding (finding.id)}
						<li>
							<div class="checks__row">
								<span class="checks__dot" data-severity={finding.severity}></span>
								<div class="checks__text">
									<p class="checks__row-title">{finding.title}</p>
									<p class="checks__detail">{finding.detail}</p>
								</div>
								{#if finding.fix}
									<button type="button" class="checks__fix" onclick={() => applyFix(finding)}>
										{finding.fix.label}
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>

	<div class="pad" bind:offsetHeight={padHeight}>
		<Keypad
			ondigit={(d) => (amount = pressDigit(amount, d))}
			oncomma={() => (amount = pressComma(amount))}
			onbackspace={() => (amount = pressBackspace(amount))}
			onclear={() => (amount = EMPTY)}
		/>

		<button type="button" class="save" disabled={!canSave} onclick={save}>
			{hasAmount && !categoryId ? 'Vyber kategorii' : 'Uložit'}
		</button>
	</div>
</main>

<Sheet open={owedSheetOpen} title="Kolik ti vrátí" onclose={() => (owedSheetOpen = false)}>
	<div class="owed-form">
		<!-- The same sentence at all three moments dluží mi is on the glass:
		     here, the /mesic card, and the tape's edit sheet. -->
		<p class="note prose">
			Zaplatil jsi celou částku, takže celá jde ze zůstatku. Tohle si jen pamatuje, kolik se má
			vrátit — až dorazí, odškrtneš to a zapíše se příjem.
		</p>

		<label class="field">
			<span class="field__label">Částka</span>
			<input
				class="field__input field__input--mono"
				bind:value={owedInput}
				inputmode="decimal"
				placeholder="0"
			/>
		</label>

		<label class="field">
			<span class="field__label">Kdo</span>
			<input class="field__input" bind:value={owedBy} placeholder="kdo ti to vrátí" />
		</label>

		{#if owedAmount !== null && owedAmount > toMinor(amount)}
			<p class="error-text">Vrátit se má víc, než kolik jsi utratil.</p>
		{/if}

		<div class="owed-form__actions">
			<button
				type="button"
				class="btn"
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
	<div class="dates">
		{#each [0, -1, -2, -3] as offset (offset)}
			{@const value = shiftDate(offset)}
			<button
				type="button"
				class="date-option"
				class:date-option--on={date === value}
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
				class="field__input field__input--mono"
				type="date"
				value={date}
				max={today()}
				onchange={(e) => setDate(e.currentTarget.value)}
			/>
		</label>
	</div>
</Sheet>

<style>
	.icon-link {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--touch);
		height: var(--touch);
		color: var(--ink-3);
		border-radius: var(--radius-full);
		transition:
			color var(--dur-fast) var(--ease-out),
			background var(--dur-fast) var(--ease-out);
	}

	.icon-link__flag {
		position: absolute;
		top: 9px;
		right: 9px;
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--flag);
		/* Ringed in the surface it sits on, so it reads as a dot on the glyph
		   rather than as part of it at any zoom. */
		box-shadow: 0 0 0 2px var(--surface);
	}

	.icon-link:active {
		background: var(--surface-2);
		color: var(--ink);
	}

	@media (hover: hover) {
		.icon-link:hover {
			background: var(--surface-2);
			color: var(--ink);
		}
	}

	/**
	 * ── the screen ──────────────────────────────────────────────────────
	 *
	 * Two parts, and the split is the whole responsive strategy.
	 *
	 * `.pad` is `flex: none` and pinned to the bottom of the frame: the keypad
	 * is what the thumb is resting on, so it does not move, does not shrink its
	 * keys below 44 px, and never scrolls away.
	 *
	 * `.flow` is everything else, and it is the one thing on this screen that
	 * gives way. On a phone with room it never scrolls at all — `.display`
	 * absorbs the slack and the layout is identical to what it always was. When
	 * the room runs out the flow scrolls, which is the difference between "the
	 * month summary is a swipe away" and "the Uložit button is 80 px below the
	 * glass and there is no way to reach it".
	 */
	.entry {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.flow {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		/* `hidden` on the cross axis, not `auto`: the amount's pool of light is
		   painted wider than its box and must never become a sideways scroll. */
		overflow: hidden auto;
		overscroll-behavior: contain;
	}

	/* The summary keeps its size and gives up its position: below a certain
	   height it moves to the end of the flow rather than getting squashed. */
	.totals-slot {
		flex: none;
	}

	/**
	 * ── the transaction context ─────────────────────────────────────────
	 *
	 * The panel under the amount. It owns the page gutter — the same 12 px the
	 * pad is inset by — so direction, chips, date, payee and properties all
	 * start on one left edge instead of four.
	 *
	 * The rhythm is deliberate and it is not one value: `--space-2` inside the
	 * panel, because these four rows are one group, and the generous air is
	 * spent above the panel (the amount's own pool) and below it (the pad's
	 * margin), which is where the real separations are.
	 *
	 * Every row here is an honest 44 px tall. That is a change of law for this
	 * section: the old rule drew at `--control` — 24 px — and pushed the hit
	 * area back out to `--touch` with a transparent `::after`, which works but
	 * leaves the screen looking like eight identical pills with no rank between
	 * them. Rows at 44 read as an instrument; the same rows at 24 read as a
	 * settings list that got squashed.
	 *
	 * Only the category tablet is still drawn smaller than its row, at 36, and
	 * that is deliberate: it is the lightest and most numerous thing in the
	 * panel, and the size difference is half of what tells the four rows apart
	 * at a squint.
	 */
	.context {
		flex: none;
		display: flex;
		flex-direction: column;
		/**
		 * Half of `--control-gap`, and the half came back when the direction
		 * track left the panel.
		 *
		 * The full gutter — `--touch` minus `--control` — is what two rows of
		 * 24 px controls need to reach 44 px targets without meeting in the
		 * middle, and it was right when the panel had four rows and two of them
		 * were drawn small and hit big, facing each other. Three rows later,
		 * only one edge in this panel still overhangs: the chips reach eleven
		 * pixels down. The date well is a real 47 px object with no overhang at
		 * all, and the properties row spends its own `--space-2` padding before
		 * the props begin. So the second half of the gutter was holding nothing
		 * up, and the panel was reading as three stranded strips.
		 */
		gap: calc(var(--control-gap) / 2);
		padding: var(--space-2) var(--space-3) var(--space-3);
	}

	/**
	 * ── the amount ──────────────────────────────────────────────────────
	 *
	 * The object this screen is built around. It sits in a pool of light with
	 * nothing else near it; everything else on the screen is a control.
	 *
	 * It has no colour when it is an expense, because an expense is the normal
	 * case — the same rule the ledger follows. Income turns it mint, and that
	 * is the whole signal.
	 */
	/**
	 * Grid, not flex, and the reason is the cross axis.
	 *
	 * `align-items: baseline` puts the amount and the "Kč" on a shared baseline,
	 * which is right — but baseline alignment does not centre anything, so in a
	 * box that grows the number sat pinned to the top of it: four pixels of air
	 * above and twenty-nine below. A grid with `place-content: center` centres
	 * the whole row in both directions and still lets `align-items: baseline`
	 * sit the currency on the amount's baseline inside it.
	 */
	.display {
		position: relative;
		display: grid;
		grid-auto-flow: column;
		place-content: center;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		/**
		 * The one element on the screen that gives its space away — and the floor
		 * under how much it can give.
		 *
		 * It used to be `min-height: 0`, which let it shrink to eight pixels of
		 * padding while the digits inside it stayed thirty-two tall: the amount
		 * spilled straight down over the category chips. `min-content` is the
		 * honest floor. It grows into whatever the screen has spare and stops at
		 * the size of its own number.
		 */
		flex: 1 1 auto;
		min-height: min-content;
		/**
		 * The pool of light the amount floats in — painted, not laid out.
		 *
		 * It used to be an absolutely positioned `::before` at `inset: -40% -25%`,
		 * a box drawn deliberately larger than this one. A bleed like that is
		 * scrollable overflow, and the moment the flow above the pad became a
		 * scroll container it started contributing ninety phantom pixels of
		 * sideways scroll to it — enough for a focused field to jolt the whole
		 * screen sideways on its way into view.
		 *
		 * The same gradient painted at `150% 180%` from the centre resolves to
		 * exactly the same geometry: the pool's origin still sits 40 % above this
		 * box and it still fades out a fifth of the way down, so every pixel
		 * inside the box is identical. What it gives up is the spill past the
		 * edges — the dimmest end of an 8 % wash, over a page that already
		 * carries the same ambient on `body` beneath everything.
		 */
		background: var(--ambient-out) center / 150% 180% no-repeat;
		transition: background-image var(--dur-base) var(--ease-out);
	}

	/**
	 * The pool follows the direction switch.
	 *
	 * Outflow is the default, so the default pool is the warm one; income turns
	 * it mint, the same way it turns the digits mint. Only the wash moves — the
	 * digits themselves keep their own rule, colourless going out and signal
	 * coming in, so the number is never competing with its own background.
	 */
	.display--in {
		background-image: var(--ambient-in);
	}

	/**
	 * ── the coin ─────────────────────────────────────────────
	 *
	 * The one control in the pool of light, and it stands where the sign used
	 * to. Drawn as a slab rather than a bare glyph — lit top edge, hairline,
	 * its own small shadow — because a naked arrow next to a number is
	 * decoration and this thing has to read as pressable from a metre away in
	 * the dark.
	 *
	 * 46 px, so it is its own hit area and needs no borrowed one: it is the
	 * only control on this screen that is not inside a group with a
	 * `--control-gap` gutter, and the pool around it is empty in every
	 * direction.
	 */
	.coin {
		align-self: center;
		display: grid;
		place-items: center;
		flex: none;
		width: 46px;
		height: 46px;
		margin-right: var(--space-1);
		border: 1px solid var(--danger);
		border-radius: var(--radius-full);
		background: var(--danger-wash);
		color: var(--danger);
		box-shadow: var(--edge-strong);
		transition:
			background var(--dur-base) var(--ease-out),
			border-color var(--dur-base) var(--ease-out),
			color var(--dur-base) var(--ease-out),
			box-shadow var(--dur-base) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.coin:active {
		transform: scale(0.93);
	}

	/**
	 * Both states carry their own hue, and this is the one control in the app
	 * where that is right.
	 *
	 * The ledger's rule — outflow has no colour, because forty red rows is
	 * noise rather than information — is a rule about *rows*. It was already
	 * suspended here: the pool of light this coin sits in has been coral for
	 * outflow and mint for income since the screen was drawn, on the grounds
	 * that there is exactly one number on the glass and the whole question is
	 * which way it is going. A colourless switch in the middle of a coral pool
	 * was the odd one out, not the rule.
	 *
	 * So the coin is coral going out and mint coming in, and the two states are
	 * a hue apart rather than a hue and an absence. The digits keep the ledger's
	 * rule and stay ink; the coin, the ring around it and the light behind it
	 * are what answer at a glance.
	 */
	.coin--in {
		background: var(--in-wash);
		border-color: var(--in);
		color: var(--in);
		box-shadow: var(--edge-strong);
	}

	/* Hover deepens the wash it already has. Neither state falls back to grey:
	   pointing at a switch is not a reason for it to forget what it says. */
	@media (hover: hover) {
		.coin:hover {
			background: color-mix(in srgb, var(--danger) 20%, var(--surface));
		}

		.coin--in:hover {
			background: color-mix(in srgb, var(--in) 20%, var(--surface));
		}
	}

	/**
	 * The arrow turns over. It does not cross-fade into a second icon and it
	 * does not swap: `arrow-down` rotated a half turn about the grid centre
	 * *is* `arrow-up`, to the tenth of a pixel, so one glyph rotating is both
	 * states and the motion is the state change rather than a decoration on
	 * top of it.
	 */
	.coin__glyph {
		display: grid;
		place-items: center;
		transition: transform var(--dur-base) var(--ease-settle);
	}

	.coin--in .coin__glyph {
		transform: rotate(180deg);
	}

	.display__amount {
		display: flex;
		align-items: baseline;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-display);
		font-weight: 600;
		line-height: 1;
		letter-spacing: var(--track-display);
		color: var(--ink);
		overflow: hidden;
		transition: color var(--dur-base) var(--ease-out);
	}

	/* Each digit lands with weight rather than appearing. Keyed on the value, so
	   the settle runs once per keystroke and never on a re-render. */
	.display__digits {
		display: inline-block;
		animation: settle var(--dur-fast) var(--ease-out);
	}

	.display__amount--in {
		color: var(--in);
	}

	.display__currency {
		font-family: var(--font-mono);
		font-size: var(--text-lg);
		color: var(--ink-3);
	}

	@keyframes settle {
		from {
			transform: scale(1.035);
		}
		to {
			transform: scale(1);
		}
	}

	/* ── when and who ────────────────────────────────────────────────────
	   One enclosure, two affordances. The well is recessed because it is a
	   field; the date inside it is raised because it is a button. That
	   contrast is the whole label — nothing has to say "when" or "who". */

	.meta {
		display: flex;
		align-items: stretch;
		min-height: 47px;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		transition:
			border-color var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
	}

	/* The group takes the focus ring on behalf of the input inside it, so the
	   two halves stay one object even while you are typing into one of them. */
	.meta:focus-within {
		border-color: var(--signal);
		box-shadow: 0 0 0 3px var(--signal-wash);
	}

	.meta__date {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		min-width: 5.75rem;
		margin: 3px 0 3px 3px;
		padding-inline: var(--space-3);
		border-radius: calc(var(--radius-md) - 4px);
		background: var(--raised);
		color: var(--ink-2);
		font-size: var(--text-md);
		font-weight: 600;
		white-space: nowrap;
		box-shadow: var(--edge);
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	/* The one control in this group that is drawn under 44: the well is 47 and
	   its 3 px inset leaves the slab 39. Three pixels each way and it is level
	   with the payee beside it. */
	.meta__date::after {
		content: '';
		position: absolute;
		inset: -3px 0;
	}

	.meta__date:active {
		transform: scale(0.97);
	}

	@media (hover: hover) {
		.meta__date:hover {
			background: color-mix(in srgb, var(--ink) 6%, var(--raised));
			color: var(--ink);
		}
	}

	/* A date that is not today is the one thing in this group worth flagging. */
	.meta__date--flag {
		background: var(--flag-wash);
		color: var(--flag);
		font-weight: 600;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--flag) 40%, transparent);
	}

	@media (hover: hover) {
		.meta__date--flag:hover {
			background: var(--flag-wash);
			color: var(--flag);
		}
	}

	/**
	 * The payee. It finally has a target of its own: 52 px of well, the full
	 * width of what the date leaves it, and no borrowed hit area — an `<input>`
	 * takes no pseudo-element, so its box has to *be* the target.
	 *
	 * 16 px is a functional floor, not a typographic preference. Mobile Safari
	 * zooms the page when a field smaller than that takes focus, and the
	 * viewport no longer pins `maximum-scale` to stop it.
	 */
	.payee {
		flex: 1;
		min-width: 0;
		padding-inline: var(--space-3);
		border: none;
		background: none;
		font-size: var(--text-base);
		color: var(--ink);
	}

	.payee::placeholder {
		color: var(--ink-3);
	}

	/* The enclosure already drew the ring; two rings on one object is one too
	   many. */
	.payee:focus-visible {
		outline: none;
	}

	/* ── properties ──────────────────────────────────────────────────────
	   The two rarest controls in the app. They are not commands and they no
	   longer look like them: no fill, no border, just a name on the left and
	   its state on the right, under the score line that says "these belong to
	   the row above". */

	.extras {
		position: relative;
		display: flex;
		/* Two properties, not two halves of a row. Each is only as wide as what
		   it says, and the space between them is the gap rather than padding
		   inside boxes that were never really there. */
		justify-content: space-between;
		gap: var(--space-2);
		/* Pulled out by exactly the props' own padding, so the first one's name
		   lands on the panel's left edge and the second one's value on its
		   right. */
		margin-inline: calc(var(--space-2) * -1);
		padding-top: var(--space-2);
	}

	/* The machined score line: full strength in the middle, gone before it
	   reaches either end, so it never runs into anything. */
	.extras::before {
		content: '';
		position: absolute;
		top: 0;
		left: var(--space-2);
		right: var(--space-2);
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent,
			var(--hairline-2) 12%,
			var(--hairline-2) 88%,
			transparent
		);
		opacity: 0.85;
	}

	.prop {
		/* Sized to its own content: `space-between` on the row does the pushing
		   apart, so nothing has to be padded out to half the screen to get
		   there. */
		position: relative;
		flex: 0 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: var(--space-2);
		min-height: 37px;
		padding-inline: var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--ink-3);
		font-size: var(--text-sm);
		font-weight: 400;
		text-align: left;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	/* Drawn at 37, hit at 45 — on the row that is still one control. The
	   mimořádný row is two (the term and the switch), and each of those
	   carries its own borrowed hit area instead. */
	.prop--field::after {
		content: '';
		position: absolute;
		inset: -4px 0;
	}

	.prop--field:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.prop--field:hover {
			color: var(--ink-2);
		}
	}

	.prop__flip {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		transition: transform var(--dur-press) var(--ease-out);
	}

	.prop__flip::after {
		content: '';
		position: absolute;
		inset: -12px -8px;
	}

	.prop__flip:active {
		transform: scale(0.95);
	}

	.prop__name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.prop--on {
		color: var(--ink);
	}

	/* The switch itself. Small, because a property is not a decision you make
	   often — but the whole 44 px row is what you actually hit. */
	.prop__track {
		flex: none;
		position: relative;
		width: 34px;
		height: 20px;
		border-radius: var(--radius-full);
		/* The pocket law is for a well *inside a card*. This panel has no card
		   under it — it sits on the page ground — so the track is raised out of
		   the ground rather than sunk into it, or it disappears on true black. */
		background: var(--surface-3);
		transition: background var(--dur-base) var(--ease-out);
	}

	.prop__knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: var(--ink-3);
		transition:
			transform var(--dur-base) var(--ease-settle),
			background var(--dur-base) var(--ease-out);
	}

	.prop--on .prop__track {
		background: var(--signal);
	}

	.prop--on .prop__knob {
		transform: translateX(14px);
		background: var(--signal-ink);
	}

	/* Not a toggle — it opens a sheet, so it shows a disclosure until it holds
	   a value, and then it shows the value. It sits on the right-hand end of
	   the row, so its contents pack that way too. */
	.prop--field {
		justify-content: flex-end;
		text-align: right;
	}

	.prop__more {
		flex: none;
		display: grid;
		place-items: center;
		color: var(--ink-3);
		opacity: 0.7;
	}

	.prop__value {
		flex: none;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		letter-spacing: var(--track-tight);
		color: var(--in);
	}

	.prop--owed {
		color: var(--ink-2);
	}

	/* ── the pad ─────────────────────────────────────────────────────────
	   Keypad and primary action are one object, standing clear of the edges and
	   raised by luminance alone. It is the thing you touch. */

	.pad {
		/* Never shrinks and never scrolls. It is the floor of the screen: the
		   flow above it is what gives way when the glass runs out. */
		flex: none;
		margin: 0 var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
		padding: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-xl);
		box-shadow: var(--edge);
	}

	.save {
		width: 100%;
		min-height: var(--touch-lg);
		margin-top: var(--space-3);
		/* The pill is reserved for the primary action, and this is it. */
		border-radius: var(--radius-full);
		background: var(--signal);
		color: var(--signal-ink);
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: 0.005em;
		transition:
			background var(--dur-base) var(--ease-out),
			color var(--dur-base) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.save:active {
		transform: scale(0.95);
	}

	/* Refusing is a state, not an absence: it keeps the shape and drops the
	   signal, and the label says what is missing. */
	.save:disabled {
		background: var(--surface-2);
		color: var(--ink-3);
		cursor: default;
		transform: none;
	}

	/* ── checks ──────────────────────────────────────────────────────────
	   The app checking on him while he types. It reports; it never blocks. */

	.checks {
		display: flex;
		align-items: stretch;
		margin: 0 var(--space-3) var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--edge);
		transition:
			background var(--dur-base) var(--ease-out),
			border-color var(--dur-base) var(--ease-out);
	}

	.checks--warn {
		border-color: color-mix(in srgb, var(--flag) 42%, var(--hairline));
		background: var(--flag-wash);
	}

	.checks__main {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		min-height: var(--touch);
		padding-inline: var(--space-3);
		text-align: left;
	}

	.checks__dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-3);
	}

	.checks__dot[data-severity='warn'] {
		background: var(--flag);
	}

	.checks__title {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.checks__count {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--ink-3);
	}

	.checks__fix {
		flex: none;
		min-height: var(--touch);
		padding-inline: var(--space-4);
		font-size: var(--text-2xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink);
		border-left: 1px solid var(--hairline);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.checks__fix:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.checks__fix:hover {
			background: var(--surface-2);
		}
	}

	.checks__list {
		list-style: none;
		margin: 0 var(--space-3) var(--space-2);
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		/**
		 * `flex: none` is load-bearing, not tidiness.
		 *
		 * A flex item that scrolls has an automatic minimum size of zero, so in a
		 * flow that is already over its height this list was the first thing the
		 * browser squashed — to nothing. Expanding the findings opened a list
		 * 0 px tall with 255 px of content inside it.
		 */
		flex: none;
		max-height: 30dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.checks__row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}

	.checks__row .checks__dot {
		margin-top: 7px;
	}

	.checks__row .checks__fix {
		border-left: none;
		border-radius: var(--radius-xs);
		align-self: center;
		min-height: 38px;
		padding-inline: var(--space-3);
		background: var(--surface-2);
	}

	.checks__text {
		flex: 1;
		min-width: 0;
	}

	.checks__row-title {
		font-size: var(--text-md);
		font-weight: 600;
	}

	.checks__detail {
		font-size: var(--text-xs);
		color: var(--ink-2);
		line-height: var(--leading-base);
		text-wrap: pretty;
	}

	/* ── sheets ──────────────────────────────────────────────────────────── */

	.owed-form,
	.dates {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.note {
		font-size: var(--text-md);
		color: var(--ink-2);
	}

	.owed-form__actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.owed-form__actions .btn {
		flex: 1;
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
		padding-inline: var(--space-4);
		text-align: left;
		font-size: var(--text-base);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.date-option--on {
		background: var(--signal);
		border-color: var(--signal);
		color: var(--signal-ink);
		font-weight: 600;
	}

	@media (hover: hover) {
		.date-option:hover {
			border-color: var(--hairline-2);
		}

		.date-option--on:hover {
			border-color: var(--signal);
		}
	}

	.date-custom {
		margin-top: var(--space-3);
	}

	/**
	 * ── short screens ───────────────────────────────────────────────────
	 *
	 * A ladder, and it runs in one direction: air first, then type, and the
	 * scroll last. Touch targets never appear on it — 44 px is the floor at
	 * every height, and a screen too short to hold a 44 px key is a screen the
	 * flow scrolls instead.
	 */
	@media (max-height: 860px) {
		/* The air above the panel closes before the air inside it. The rows keep
		   their rhythm here; they only tighten a step further down. */
		.context {
			padding-top: var(--space-1);
			padding-bottom: var(--space-2);
		}

		.display {
			padding-block: var(--space-1);
		}

		.display__amount {
			font-size: clamp(2.25rem, 11vw, 3rem);
		}

		/* The slab's own padding gives way, never the key size. */
		.pad {
			margin-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
			padding: var(--space-2);
		}

		.save {
			min-height: 48px;
			margin-top: var(--space-2);
		}
	}

	/**
	 * Very short — a browser tab rather than the installed app, or the keyboard
	 * up over the payee field.
	 *
	 * The amount takes one step down: at 32 px it is still four times the size
	 * of anything else on the screen. Below this the flow starts scrolling, and
	 * the pad stops giving anything at all.
	 */
	@media (max-height: 700px) {
		.display__amount {
			font-size: clamp(1.75rem, 9vw, 2rem);
		}

		.display__currency {
			font-size: var(--text-sm);
		}

		/* Down with the number it belongs to — and below 44 for the first
		   time, so it borrows the pool's empty air back as a hit area the way
		   every other small control in this app does. */
		.coin {
			position: relative;
			width: 38px;
			height: 38px;
		}

		.coin::after {
			content: '';
			position: absolute;
			inset: -3px;
		}

		/**
		 * The last of the panel's air, and only the outer padding gives it up.
		 *
		 * The gap between the rows does not compress at any height. What is left
		 * of it is the chips' own overhang, and closing it collapsed a 46 px
		 * chip to 27. From here the flow scrolls rather than the targets
		 * shrinking.
		 */
		.context {
			gap: var(--space-2);
			padding-block: 2px var(--space-1);
		}

		/* Last of the air: the slab closes around the keys and the button comes
		   down to the floor itself. Neither goes below it. */
		.pad {
			margin-bottom: calc(var(--space-1) + env(safe-area-inset-bottom, 0px));
		}

		.save {
			min-height: var(--touch);
			margin-top: var(--space-1);
		}

		.checks {
			margin-bottom: var(--space-1);
		}
	}

	/**
	 * Shorter than the pad plus the month slab — the keyboard up over a small
	 * Android, or a landscape phone.
	 *
	 * At this height the flow is a hundred-odd pixels tall, and whatever sits at
	 * the top of it is the only thing anyone will see. That has to be the number
	 * being typed: watching your own digits appear is the entire feedback loop
	 * of this screen, and the month's totals are reference you consult, not
	 * something you need while your thumb is on the pad.
	 *
	 * So the summary moves below the fold rather than out of the document. It is
	 * one short swipe away, still reachable, still in the same reading order for
	 * anything that reads the page rather than looks at it.
	 */
	@media (max-height: 480px) {
		.totals-slot {
			order: 1;
		}

		/* The due strip is ledger business, same as the totals — it joins them
		   below the fold. One swipe away, same reading order in the DOM. */
		.flow > :global(.due-strip) {
			order: 1;
		}

		.display {
			padding-block: 0;
		}

		/* Rare props drawn at --control, hit at 44 via the ::after every other
		   small control in the app already uses. */
		.extras {
			padding-top: var(--space-1);
		}

		.prop {
			min-height: var(--control);
		}

		.prop--field::after {
			inset: -10px 0;
		}

		.pad {
			padding: var(--space-1);
		}
	}

	/**
	 * ── landscape ───────────────────────────────────────────────────────
	 *
	 * Shorter than a keypad is tall, and wider than it is high: a phone on its
	 * side, or a desktop window squashed down to a strip.
	 *
	 * Stacking is the wrong answer here — it leaves the pad hanging below the
	 * glass and half the width empty. The column becomes two: the amount and its
	 * controls on one side, the pad on the other, both fully on screen with the
	 * keys still at their full size. No target moves, nothing scrolls, and the
	 * thumb that was holding the phone is already next to the pad.
	 */
	@media (max-height: 560px) and (min-width: 34rem) {
		.entry {
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
			margin: var(--space-2) var(--space-3) calc(var(--space-2) + env(safe-area-inset-bottom, 0px))
				0;
		}

		/* With the width to spare, the amount goes back up rather than down. */
		.display__amount {
			font-size: clamp(2rem, 5vw, 2.75rem);
		}
	}
</style>
