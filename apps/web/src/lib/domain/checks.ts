/**
 * The checks.
 *
 * Every rule here exists because the spreadsheet already went wrong that way.
 * The comment above each one names the actual damage in `Výdaje 2026.xlsx`, so
 * nobody later removes a rule thinking it is theoretical.
 *
 * Two entry points:
 *   `checkDraft`  — runs on every keystroke while an entry is being typed.
 *                   Cheap, and it can still be acted on with one tap.
 *   `checkMonth`  — runs over a finished month. This is the monthly close.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { abs, percentOf, sum, type Minor } from './money';
import { RECORDS, counted } from './czech';
import { daysBetween, monthKey, shiftMonth, type IsoDate } from './datetime';
import type { Category, Txn } from './types';
import { isVagueDescription, normalize, numbersIn, suggestBucket } from './vocabulary';

export type Severity = 'warn' | 'info';

export type Fix =
	| { kind: 'set-category'; categoryId: string; label: string }
	| { kind: 'mark-one-off'; label: string }
	| { kind: 'switch-direction'; label: string }
	| { kind: 'open-txn'; txnId: string; label: string }
	/**
	 * Raised by `domain/holdings.ts`, never by anything in this file — a stale
	 * valuation is not a fact about the ledger and `summariseMonth` must stay
	 * unable to see a holding (INVESTMENTS §1). The type lives here because
	 * `Finding` does, and one shape of finding is worth more than two.
	 */
	| { kind: 'value-holding'; holdingId: string; label: string }
	/**
	 * Drain a bucket: open the month's rows in it and re-file them one tap at a
	 * time. Raised only by `other-overflow`, which could state the problem and
	 * do nothing about it from P1 until T4.
	 */
	| { kind: 'drain-bucket'; categoryId: string; label: string };

export interface Finding {
	/** Stable for the same problem, so a dismissal can stick. */
	id: string;
	rule: string;
	severity: Severity;
	title: string;
	detail: string;
	txnId?: string;
	fix?: Fix;
}

/** Above this, an expense is a decision rather than a habit. */
const ONE_OFF_THRESHOLD = 1_000_000 as Minor; // 10 000 Kč

/** A description this vague on an amount this large explains nothing. */
const VAGUE_AMOUNT_THRESHOLD = 100_000 as Minor; // 1 000 Kč

/** Share of monthly outflow that "OSTATNÍ" may reach before it is a problem. */
const OTHER_BUCKET_LIMIT_PCT = 15;

export interface Draft {
	/** Positive magnitude as typed; direction is separate. */
	amount: Minor;
	direction: 'out' | 'in';
	categoryId: string | null;
	payee: string;
	date: IsoDate;
	isOneOff: boolean;
}

export interface CheckContext {
	categories: Category[];
	/** Recent transactions, newest first. Used for duplicate detection. */
	recent: Txn[];
}

function categoryOf(context: CheckContext, id: string | null): Category | undefined {
	return id ? context.categories.find((c) => c.id === id) : undefined;
}

function findBucket(context: CheckContext, normalizedName: string): Category | undefined {
	return context.categories.find(
		(c) => !c.isArchived && !c.isDeleted && normalize(c.name) === normalizedName
	);
}

// ── entry time ──────────────────────────────────────────────────────────────

/**
 * Checks that can still be acted on before the entry is saved. None of them
 * block saving — a check that stops you recording an expense is worse than the
 * mistake it prevents.
 */
export function checkDraft(draft: Draft, context: CheckContext): Finding[] {
	const findings: Finding[] = [];
	const description = draft.payee.trim();
	const chosen = categoryOf(context, draft.categoryId);

	// 25 286 Kč of food was filed under BYDLENÍ, LIFESTYLE, DARY and PROJEKTY
	// over eight months, while JÍDLO reported 13 083 Kč. The category with the
	// most room to improve was the one being under-reported threefold.
	if (description && draft.direction === 'out') {
		const suggestion = suggestBucket(description);
		if (suggestion) {
			const target = findBucket(context, suggestion);
			if (target && target.id !== draft.categoryId) {
				findings.push({
					id: `misfiled:${suggestion}`,
					rule: 'misfiled',
					severity: 'warn',
					title: chosen ? `Spíš ${target.name}?` : `Vypadá to na ${target.name}`,
					detail: chosen
						? `„${description}“ jsi jindy dával do ${target.name}, teď to míří do ${chosen.name}.`
						: `Podle popisu „${description}“.`,
					fix: { kind: 'set-category', categoryId: target.id, label: `Dát do ${target.name}` }
				});
			}
		}
	}

	// "Netflix - 379" recorded as 74 Kč. "objednávka (2415 Zůza)" as 5 008 Kč.
	// The amount is his share and the description carries the rest — but nothing
	// records who owes what, so it can never be reconciled.
	if (description) {
		const mentioned = numbersIn(description).filter((n) => n !== abs(draft.amount));
		if (mentioned.length > 0 && draft.amount !== 0) {
			findings.push({
				id: 'unclear-number',
				rule: 'unclear-number',
				severity: 'info',
				title: 'V popisu je jiné číslo než částka',
				detail:
					'Je to podíl ze společné platby? Napiš do popisu, kdo dluží zbytek — za měsíc si to nevybavíš.'
			});
		}
	}

	// "opak. obj" carried 17 074 Kč in a single month.
	if (abs(draft.amount) >= VAGUE_AMOUNT_THRESHOLD && isVagueDescription(description)) {
		findings.push({
			id: 'vague',
			rule: 'vague',
			severity: 'warn',
			title: 'Popis nic neříká',
			detail: 'U téhle částky si za měsíc nevzpomeneš, co to bylo. Napiš to konkrétně.'
		});
	}

	// KVĚTEN cost 106 308 Kč instead of the usual ~65 000, because a 41 890 Kč
	// front door sat in the same column as the groceries. It moved the average
	// for the whole year.
	if (abs(draft.amount) >= ONE_OFF_THRESHOLD && !draft.isOneOff && draft.direction === 'out') {
		findings.push({
			id: 'one-off',
			rule: 'one-off',
			severity: 'info',
			title: 'Jednorázový výdaj?',
			detail: 'Označ ho, ať nekazí měsíční průměr. Do zůstatku se počítá dál.',
			fix: { kind: 'mark-one-off', label: 'Označit jako jednorázový' }
		});
	}

	// "Zůza - bydlení plyn 1 250" sat in PŘÍJEM while the full 2 500 sat in
	// BYDLENÍ. Both sides inflated: income looked bigger, spending looked bigger.
	if (draft.direction === 'in' && description) {
		const suggestion = suggestBucket(description);
		const target = suggestion ? findBucket(context, suggestion) : undefined;
		if (target && !target.isIncome) {
			findings.push({
				id: 'refund-as-income',
				rule: 'refund-as-income',
				severity: 'warn',
				title: 'Příjem, nebo vrácení peněz?',
				detail: `Vrácený podíl zapiš u toho výdaje jako „dluží mi“ a odškrtni ho, až dorazí. Jako příjem ti nafoukne příjem i výdaje zároveň.`,
				fix: { kind: 'set-category', categoryId: target.id, label: `Dát do ${target.name}` }
			});
		}
	}

	// Retyping the same subscription every month is how "-18" survived twice.
	const duplicate = findDuplicate(draft, context.recent);
	if (duplicate) {
		findings.push({
			id: `duplicate:${duplicate.id}`,
			rule: 'duplicate',
			severity: 'warn',
			title: 'Tohle už tam jednou je',
			detail: `Stejná částka i popis ${describeAge(duplicate.date, draft.date)}.`,
			txnId: duplicate.id,
			fix: { kind: 'open-txn', txnId: duplicate.id, label: 'Ukázat původní' }
		});
	}

	return findings;
}

function findDuplicate(draft: Draft, recent: readonly Txn[]): Txn | undefined {
	if (draft.amount === 0) return undefined;
	const signed = draft.direction === 'out' ? -abs(draft.amount) : abs(draft.amount);
	const description = normalize(draft.payee);
	if (!description) return undefined;

	return recent.find(
		(txn) =>
			!txn.isDeleted &&
			txn.amount === signed &&
			normalize(txn.payee) === description &&
			Math.abs(daysBetween(txn.date, draft.date)) <= 3
	);
}

function describeAge(from: IsoDate, to: IsoDate): string {
	const days = Math.abs(daysBetween(from, to));
	if (days === 0) return 'dneska';
	if (days === 1) return 'včera';
	return `před ${days} dny`;
}

// ── monthly close ───────────────────────────────────────────────────────────

export interface MonthContext {
	month: string; // YYYY-MM
	txns: Txn[]; // every live transaction of the account
	categories: Category[];
	today: IsoDate;
}

export interface BucketTotal {
	category: Category | null; // null = uncategorised
	total: Minor; // signed, everything
	/** The part of `total` that was marked one-off. */
	oneOffTotal: Minor;
	count: number;
	/** Percent of the month's whole outflow — what the bar draws. */
	share: number;
	/**
	 * Percent of the month's *recurring* outflow. This is the honest one: a
	 * 41 890 Kč front door should not make the dumping-ground bucket look small.
	 */
	recurringShare: number;
}

export interface MonthSummary {
	month: string;
	income: Minor;
	outflow: Minor; // negative
	net: Minor;
	/** Outflow excluding one-offs — the number that says what life actually costs. */
	recurringOutflow: Minor;
	oneOffOutflow: Minor;
	buckets: BucketTotal[];
	findings: Finding[];
}

/**
 * The rows a month is measured over: live, in the month, and **not a transfer
 * leg** (Q49). Moving money to the EUR account is not spending and the money
 * arriving there is not income — the balance sees both legs, the summary sees
 * neither, or every transfer would inflate both sides of the same koruna.
 */
function measuredRows(context: MonthContext): Txn[] {
	return context.txns.filter(
		(t) => !t.isDeleted && t.transferPairId === null && monthKey(t.date) === context.month
	);
}

export function summariseMonth(context: MonthContext): MonthSummary {
	const { month, categories } = context;
	const rows = measuredRows(context);

	// An inflow filed under a spending bucket is a refund, not income: it nets
	// against what that bucket cost. Counting it as income is the mistake the
	// spreadsheet made every month — the gas bill showed 2 500 Kč of spending and
	// 1 250 Kč of "income", inflating both sides of the same transaction.
	const isIncomeRow = (txn: Txn) =>
		txn.categoryId === null || (categories.find((c) => c.id === txn.categoryId)?.isIncome ?? false);

	const inflowRows = rows.filter((t) => t.amount > 0);
	const income = sum(inflowRows.filter(isIncomeRow).map((t) => t.amount));

	const spendRows = [
		...rows.filter((t) => t.amount < 0),
		...inflowRows.filter((t) => !isIncomeRow(t))
	];
	const outflow = sum(spendRows.map((t) => t.amount));
	const oneOffOutflow = sum(spendRows.filter((t) => t.isOneOff).map((t) => t.amount));

	const byCategory = new Map<string | null, Txn[]>();
	for (const row of spendRows) {
		const key = row.categoryId;
		const bucket = byCategory.get(key);
		if (bucket) bucket.push(row);
		else byCategory.set(key, [row]);
	}

	const recurringOutflow = (outflow - oneOffOutflow) as Minor;

	const buckets: BucketTotal[] = [...byCategory.entries()]
		.map(([id, group]) => {
			const total = sum(group.map((t) => t.amount));
			const oneOffTotal = sum(group.filter((t) => t.isOneOff).map((t) => t.amount));
			return {
				category: categories.find((c) => c.id === id) ?? null,
				total,
				oneOffTotal,
				count: group.length,
				share: percentOf(total, outflow),
				recurringShare: percentOf((total - oneOffTotal) as Minor, recurringOutflow)
			};
		})
		.sort((a, b) => a.total - b.total);

	return {
		month,
		income,
		outflow,
		net: (income + outflow) as Minor,
		recurringOutflow,
		oneOffOutflow,
		buckets,
		findings: checkMonth(context, { income, outflow, buckets })
	};
}

function checkMonth(
	context: MonthContext,
	totals: { income: Minor; outflow: Minor; buckets: BucketTotal[] }
): Finding[] {
	const findings: Finding[] = [];
	const { month } = context;
	const rows = measuredRows(context);

	// OSTATNÍ carried 100 895 Kč across eight months — the second largest bucket
	// after housing, and it explains nothing about where the money went.
	for (const bucket of totals.buckets) {
		if (!bucket.category) continue;
		if (normalize(bucket.category.name) !== 'ostatni') continue;
		if (bucket.recurringShare > OTHER_BUCKET_LIMIT_PCT) {
			findings.push({
				id: `other-overflow:${month}`,
				rule: 'other-overflow',
				severity: 'warn',
				title: `OSTATNÍ je ${bucket.recurringShare} % běžných výdajů`,
				detail: `${counted(bucket.count, RECORDS)}. Co z toho patří do vlastní kategorie? Dokud to sedí tady, nejde s tím nic dělat.`,
				fix: {
					kind: 'drain-bucket',
					categoryId: bucket.category.id,
					label: 'Přebrat řádky'
				}
			});
		}
	}

	// The one queue that has to reach zero, or the month cannot be closed.
	const uncategorised = rows.filter((t) => t.amount < 0 && !t.categoryId);
	if (uncategorised.length > 0) {
		findings.push({
			id: `uncategorised:${month}`,
			rule: 'uncategorised',
			severity: 'warn',
			title: `${counted(uncategorised.length, RECORDS)} bez kategorie`,
			detail: 'Zařaď je, jinak měsíční přehled lže.'
		});
	}

	// There used to be a `coverage` finding here — "zapsáno 11 z 27 dní", raised
	// when too few days carried a row. It was retired on 2026-08-28 along with
	// the day mark it was built on: once a day with nothing on it counts as a
	// day that cost nothing, there are no holes left for it to point at and it
	// would fire on every frugal month. `coverage.ts` now answers the question
	// that survived — how many days cost nothing — and `/mesic` shows it as a
	// figure rather than as a complaint.

	// LEDEN −23 355. BŘEZEN −238. KVĚTEN −45 937. ČERVENEC −10 048.
	// Four of eight months in the red, and the spreadsheet never said so.
	if (totals.income + totals.outflow < 0 && totals.income !== 0) {
		findings.push({
			id: `overspend:${month}`,
			rule: 'overspend',
			severity: 'warn',
			title: 'Utraceno víc, než přišlo',
			detail: 'Podívej se na jednorázové výdaje — pokud tam žádné nejsou, je to trend.'
		});
	}

	// Twelve subscriptions were retyped by hand every month. A missing one is
	// invisible in a spreadsheet; here it is a question.
	for (const missing of findMissingRecurring(context)) {
		findings.push(missing);
	}

	return findings;
}

/**
 * A payee seen in each of the three previous months but not in this one.
 *
 * Deliberately conservative: three months of history before it says anything,
 * and it only ever asks a question.
 */
export function findMissingRecurring(context: MonthContext): Finding[] {
	const { month, txns } = context;
	const live = txns.filter(
		(t) => !t.isDeleted && t.transferPairId === null && t.amount < 0 && t.payee.trim()
	);

	const previous = [1, 2, 3].map((back) => shiftMonth(month, -back));
	const seenIn = new Map<string, Set<string>>();
	const label = new Map<string, string>();

	for (const txn of live) {
		const key = normalize(txn.payee);
		const bucket = seenIn.get(key) ?? new Set<string>();
		bucket.add(monthKey(txn.date));
		seenIn.set(key, bucket);
		if (!label.has(key)) label.set(key, txn.payee.trim());
	}

	const findings: Finding[] = [];
	for (const [key, months] of seenIn) {
		if (months.has(month)) continue;
		if (!previous.every((m) => months.has(m))) continue;
		findings.push({
			id: `missing-recurring:${month}:${key}`,
			rule: 'missing-recurring',
			severity: 'info',
			title: `„${label.get(key)}“ tenhle měsíc chybí`,
			detail: 'Platíš to každý měsíc. Zapomnělo se, nebo jsi to zrušil?'
		});
	}
	return findings.slice(0, 6);
}
