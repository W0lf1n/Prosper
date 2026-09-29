/**
 * The spreadsheet export, laid out as Petr's own workbook was — Q81.
 *
 * `Výdaje 2026.xlsx` had one sheet per month: a column pair per bucket —
 * the amount and its `popis` — with the bucket totals in the second row,
 * PŘÍJEM first in green, the buckets in pink, and `CELKEM` (income less
 * expenses) and `VÝDAJE` at the end; then a `SUMA` sheet over the months.
 * That is the shape this writes, so the export opens as the file it
 * replaced — with what the app knows and the workbook never did carried in
 * the same shape:
 *
 *   - a date on every row, at the front of its `popis`, and the flags the
 *     app keeps — one-off, a hold, who pays their share back;
 *   - JEDNORÁZOVÉ, BĚŽNÝ CHOD and VRACÍ SE beside the totals;
 *   - on `SUMA`, days without an expense and the 10/10/10/70 split per month;
 *   - one sheet each for the rows, the receivables, the recurring payments,
 *     the goals and their months, the accounts, the wealth, the plans and
 *     the categories — the app's other screens, as tables.
 *
 * Every figure is the app's own. A row lands in a column by the rule
 * `summariseMonth` uses — income is an inflow to an income bucket or to none,
 * a refund nets against its bucket — so a sheet's CELKEM is the month's net
 * on Přehled to the haléř. Accounts are never summed together: each gets its
 * own months and its own SUMA, because koruny and euros are not one column.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import { ACCOUNT_KIND_LABEL, EXCHANGE_CATEGORY_ID, isTransfer, openingTotal } from './accounts';
import { summariseMonth, type MonthSummary } from './checks';
import { monthCoverage } from './coverage';
import { capitalize } from './czech';
import { formatMonthHeading, formatShortDate, monthKey, type IsoDate } from './datetime';
import { goalStatus, monthHistory, targetsByMonth } from './goals';
import { KIND_LABEL } from './holdings';
import { balanceOf } from './ledger';
import { ZERO, abs, formatMoney, minor, mulRatio, neg, sum, type Minor } from './money';
import { lineNet } from './plans';
import { CLASS_LABEL, PROSPERITY_CLASSES, SPEND_TYPE_LABEL, prosperitySplit } from './prosperity';
import { sharesOf } from './receivables';
import { MODE_LABEL, netOfSchedule, scheduleSharesOf } from './recurring';
import type {
	Account,
	Category,
	Goal,
	Holding,
	MonthTarget,
	Plan,
	Schedule,
	Txn,
	TxnSource,
	Valuation
} from './types';
import type { Cell, CellStyle, CellValue, Sheet } from './xlsx';

export interface WorkbookInput {
	accounts: readonly Account[];
	txns: readonly Txn[];
	categories: readonly Category[];
	schedules: readonly Schedule[];
	goals: readonly Goal[];
	monthTargets: readonly MonthTarget[];
	holdings: readonly Holding[];
	valuations: readonly Valuation[];
	plans: readonly Plan[];
	/** The account the app is on: its months come first, and its latest is the tab it opens on. */
	activeAccountId: string | null;
	today: IsoDate;
}

// ── cells ───────────────────────────────────────────────────────────────────

const styled = (value: CellValue, style: CellStyle): Cell => ({ value, style });

/** A figure the way the workbook wrote it: bare, "2380". */
const bare = (value: Minor, formula?: string): CellValue =>
	formula ? { money: value, formula } : { money: value };

/** The header of every plain table: bold on grey, so it reads as the template's top row. */
const HEAD: CellStyle = { font: 'bold', fill: 'head' };
const head = (titles: readonly string[]): Cell[] => titles.map((t) => styled(t, HEAD));

const yes = (flag: boolean): string => (flag ? 'ano' : '');

/** A1-style column letters, 0-based. */
function letter(column: number): string {
	let name = '';
	let n = column;
	do {
		name = String.fromCharCode(65 + (n % 26)) + name;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return name;
}

/** "Září 2026" — the month through Intl, as a sheet and a row name. */
function monthName(month: string): string {
	return capitalize(formatMonthHeading(`${month}-01`));
}

// ── which column a row belongs to ───────────────────────────────────────────

/** `in` adds to PŘÍJEM, `out` to VÝDAJE — the two halves of CELKEM. */
type Side = 'in' | 'out';

interface Column {
	key: string;
	categoryId: string | null;
	side: Side;
	title: string;
}

const keyOf = (categoryId: string | null, side: Side) => `${side}:${categoryId ?? '∅'}`;

/**
 * The side `summariseMonth` puts a row on. An inflow is income when its
 * bucket is an income bucket or it has none; an inflow to a spending bucket
 * is a refund and nets against that bucket; every outflow is spending. A row
 * of zero is on neither, as it is there.
 */
function sideOf(txn: Txn, byId: ReadonlyMap<string, Category>): Side | null {
	if (txn.amount < 0) return 'out';
	if (txn.amount === 0) return null;
	const isIncome = txn.categoryId === null || (byId.get(txn.categoryId)?.isIncome ?? false);
	return isIncome ? 'in' : 'out';
}

/** What the row puts in its column: income as it came, spending as a positive cost. */
const columnValue = (txn: Txn, side: Side): Minor => (side === 'in' ? txn.amount : neg(txn.amount));

/**
 * The column pairs of one account, the same on every month so the months
 * line up: every live bucket, in the app's order, whether or not it was used
 * — the template's columns were fixed too — and any other the rows reach: an
 * archived bucket with history, SMĚNA once money was exchanged, a spending
 * row filed under an income bucket, and the rows nobody filed.
 */
function columnsFor(rows: readonly Txn[], categories: readonly Category[]): Column[] {
	const byId = new Map(categories.map((c) => [c.id, c]));
	const used = new Set<string>();
	for (const txn of rows) {
		const side = sideOf(txn, byId);
		if (side !== null) used.add(keyOf(txn.categoryId, side));
	}

	const ordered = [...categories].sort(
		(a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'cs')
	);
	const shown = (c: Category, side: Side) =>
		used.has(keyOf(c.id, side)) ||
		(!c.isDeleted &&
			!c.isArchived &&
			c.id !== EXCHANGE_CATEGORY_ID &&
			c.isIncome === (side === 'in'));

	const columns: Column[] = [];
	for (const side of ['in', 'out'] as const) {
		for (const c of ordered) {
			if (!shown(c, side)) continue;
			const title = c.isIncome && side === 'out' ? `${c.name} (výdaj)` : c.name;
			columns.push({ key: keyOf(c.id, side), categoryId: c.id, side, title });
		}
		// A row pointing at a bucket that is gone reads as unfiled, as on Přehled.
		const orphans = rows.some(
			(t) => sideOf(t, byId) === side && (t.categoryId === null || !byId.has(t.categoryId))
		);
		if (orphans) {
			columns.push({ key: keyOf(null, side), categoryId: null, side, title: 'BEZ KATEGORIE' });
		}
	}
	return columns;
}

function columnKeyOf(txn: Txn, byId: ReadonlyMap<string, Category>): string | null {
	const side = sideOf(txn, byId);
	if (side === null) return null;
	const known = txn.categoryId !== null && byId.has(txn.categoryId);
	return keyOf(known ? txn.categoryId : null, side);
}

// ── the popis ───────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<TxnSource, string> = {
	manual: 'ručně',
	'import-gpc': 'z výpisu',
	'bank-api': 'z banky',
	recurring: 'pravidelná platba',
	adjustment: 'vyrovnání zůstatku'
};

/**
 * "12. 9. Lidl · jednorázový · dluží Bea 250,00 Kč" — the payee, with the
 * date the workbook never had in front of it and the app's flags behind it.
 */
function popisOf(txn: Txn, code: string): string {
	const tags: string[] = [];
	if (isTransfer(txn)) tags.push('směna');
	if (txn.source === 'recurring') tags.push('pravidelná');
	if (txn.isOneOff) tags.push('jednorázový');
	if (txn.isProvisional) tags.push('blokace');
	for (const share of sharesOf(txn)) {
		const who = share.who.trim() || 'někdo';
		const amount = formatMoney(abs(share.amount), { code });
		tags.push(
			share.settledByTxnId === null ? `dluží ${who} ${amount}` : `vyrovnáno ${who} ${amount}`
		);
	}
	const what = txn.payee.trim() || txn.note?.trim() || 'bez popisu';
	return [`${formatShortDate(txn.date)} ${what}`, ...tags].join(' · ');
}

const oldestFirst = (a: Txn, b: Txn) =>
	a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date);

/** Everything that comes back on this month's rows, settled or not. */
function owedOn(rows: readonly Txn[]): Minor {
	return sum(rows.flatMap((t) => sharesOf(t).map((s) => abs(s.amount))));
}

// ── one month, the template ─────────────────────────────────────────────────

const TITLE: CellStyle = { font: 'title', center: true };
const QUIET: CellStyle = { font: 'quiet', center: true };
const EXTRA: CellStyle = { font: 'bold', center: true };
const EXTRAS = ['JEDNORÁZOVÉ', 'BĚŽNÝ CHOD', 'VRACÍ SE'] as const;

interface MonthInput {
	name: string;
	rows: readonly Txn[];
	columns: readonly Column[];
	summary: MonthSummary;
	byId: ReadonlyMap<string, Category>;
	code: string;
}

function monthSheet({ name, rows, columns, summary, byId, code }: MonthInput): Sheet {
	const entries = new Map<string, Txn[]>(columns.map((c) => [c.key, []]));
	for (const txn of [...rows].sort(oldestFirst)) {
		const key = columnKeyOf(txn, byId);
		if (key !== null) entries.get(key)?.push(txn);
	}

	const depth = Math.max(0, ...[...entries.values()].map((list) => list.length));
	const lastRow = Math.max(3, depth + 2);
	const netColumn = columns.length * 2;
	const spendColumn = netColumn + 1;

	const header: Cell[] = [
		...columns.flatMap((c) => [styled(c.title, TITLE), styled('popis', QUIET)]),
		styled('CELKEM', TITLE),
		styled('VÝDAJE', TITLE),
		...EXTRAS.map((title) => styled(title, EXTRA))
	];

	const totals: Cell[] = columns.flatMap((column, index) => {
		const values = entries.get(column.key)!.map((t) => columnValue(t, column.side));
		const at = letter(index * 2);
		return [
			styled(bare(sum(values), `SUM(${at}3:${at}${lastRow})`), {
				fill: column.side === 'in' ? 'income' : 'bucket',
				center: true,
				bare: true
			}),
			styled(null, { fill: 'note' })
		];
	});

	const refs = (side: Side) =>
		columns.flatMap((c, i) => (c.side === side ? [`${letter(i * 2)}2`] : []));
	const incomeRefs = refs('in');
	const spendRefs = refs('out');
	const spent = neg(summary.outflow);
	const netFormula = `${incomeRefs.join('+') || '0'}-${letter(spendColumn)}2`;

	totals.push(
		styled(bare(summary.net, netFormula), { fill: 'net', font: 'bold', center: true, bare: true }),
		styled(bare(spent, spendRefs.join('+') || undefined), {
			fill: 'spend',
			font: 'bold',
			center: true,
			bare: true
		}),
		styled(bare(neg(summary.oneOffOutflow)), { center: true, bare: true }),
		styled(bare(neg(summary.recurringOutflow)), { center: true, bare: true }),
		styled(bare(owedOn(rows)), { center: true, bare: true })
	);

	const body: Cell[][] = Array.from({ length: depth }, (_, line) =>
		columns.flatMap((column) => {
			const txn = entries.get(column.key)![line];
			return txn ? [bare(columnValue(txn, column.side)), popisOf(txn, code)] : [null, null];
		})
	);

	return {
		name,
		header,
		rows: [totals, ...body],
		widths: [
			...columns.flatMap((c) => [Math.max(12, c.title.length + 4), 30]),
			12,
			12,
			...EXTRAS.map((t) => t.length + 4)
		],
		frozenRows: 2,
		headerHeight: 32
	};
}

// ── SUMA ────────────────────────────────────────────────────────────────────

interface SumaInput {
	name: string;
	months: readonly string[];
	summaries: readonly MonthSummary[];
	rows: readonly Txn[];
	columns: readonly Column[];
	byId: ReadonlyMap<string, Category>;
	/** The whole ledger — days without an expense are about the person (Q66). */
	allTxns: readonly Txn[];
	today: IsoDate;
}

/** A whole percent that keeps its sign — `money.percentOf` drops it. */
function signedPercent(part: number, whole: number): number {
	return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/**
 * One row per month, the buckets across — what the workbook's own `SUMA`
 * was, computed from the rows rather than dragged, so no month is ever left
 * out of it. The second row totals the period and the third averages it; the
 * split and the quiet days are the app's, added at the end.
 */
function sumaSheet(input: SumaInput): Sheet {
	const { months, summaries, rows, columns, byId } = input;
	const first = 4;
	const last = Math.max(first, first + months.length - 1);
	const count = Math.max(1, months.length);

	const perMonth = months.map((month, index) => {
		const summary = summaries[index]!;
		const inMonth = rows.filter((t) => monthKey(t.date) === month);
		const byColumn = new Map<string, Minor>();
		for (const txn of inMonth) {
			const key = columnKeyOf(txn, byId);
			const side = sideOf(txn, byId);
			if (key === null || side === null) continue;
			byColumn.set(key, minor((byColumn.get(key) ?? 0) + columnValue(txn, side)));
		}
		const split = prosperitySplit({ income: summary.earned, buckets: summary.buckets });
		return {
			month,
			figures: [
				...columns.map((c) => byColumn.get(c.key) ?? ZERO),
				summary.net,
				neg(summary.outflow),
				neg(summary.oneOffOutflow),
				neg(summary.recurringOutflow),
				owedOn(inMonth)
			],
			quiet: monthCoverage({ month, txns: input.allTxns, today: input.today }).quiet,
			earned: summary.earned,
			classes: split.slices.map((s) => s.amount),
			percents: [...split.slices.map((s) => s.percent), split.leftPercent]
		};
	});

	const moneyTitles = [...columns.map((c) => c.title), 'CELKEM', 'VÝDAJE', ...EXTRAS];
	const splitTitles = [...PROSPERITY_CLASSES.map((c) => `${CLASS_LABEL[c]} %`), 'Zbývá %'];

	const fillOf = (index: number): CellStyle['fill'] => {
		if (index < columns.length) return columns[index]!.side === 'in' ? 'income' : 'bucket';
		if (index === columns.length) return 'net';
		if (index === columns.length + 1) return 'spend';
		return undefined;
	};

	const totals = moneyTitles.map((_, index) => {
		const at = letter(index + 1);
		const total = sum(perMonth.map((m) => m.figures[index]!));
		return styled(bare(total, `SUM(${at}${first}:${at}${last})`), {
			fill: fillOf(index),
			font: index >= columns.length && index <= columns.length + 1 ? 'bold' : undefined,
			center: true,
			bare: true
		});
	});
	const earned = sum(perMonth.map((m) => m.earned));
	const classTotals = PROSPERITY_CLASSES.map((_, i) => sum(perMonth.map((m) => m.classes[i]!)));
	const periodPercents = [
		...classTotals.map((amount) => signedPercent(amount, earned)),
		signedPercent(earned - sum(classTotals), earned)
	];

	const averages = moneyTitles.map((_, index) => {
		const at = letter(index + 1);
		const total = sum(perMonth.map((m) => m.figures[index]!));
		return styled(bare(mulRatio(total, 1, count), `ROUND(AVERAGE(${at}${first}:${at}${last}),2)`), {
			center: true,
			bare: true
		});
	});

	const quietTotal = perMonth.reduce((total, m) => total + m.quiet, 0);

	return {
		name: input.name,
		header: [
			styled('MĚSÍC', TITLE),
			...moneyTitles.map((t, i) => styled(t, i < columns.length + 2 ? TITLE : EXTRA)),
			styled('DNY BEZ VÝDAJE', EXTRA),
			...splitTitles.map((t) => styled(t, EXTRA))
		],
		rows: [
			[
				styled('CELKEM', { font: 'bold' }),
				...totals,
				styled(quietTotal, { center: true }),
				...periodPercents.map((p) => styled(p, { center: true }))
			],
			[styled('PRŮMĚR', { font: 'bold' }), ...averages],
			...perMonth.map((m) => [
				monthName(m.month),
				...m.figures.map((f) => styled(bare(f), { center: true, bare: true })),
				styled(m.quiet, { center: true }),
				...m.percents.map((p) => styled(p, { center: true }))
			])
		],
		widths: [
			14,
			...moneyTitles.map((t) => Math.max(12, t.length + 4)),
			16,
			...splitTitles.map((t) => t.length + 4)
		],
		frozenRows: 3,
		headerHeight: 32
	};
}

// ── the other screens, as tables ────────────────────────────────────────────

function ledgerSheet(input: WorkbookInput, accountById: ReadonlyMap<string, Account>): Sheet {
	const byId = new Map(input.categories.map((c) => [c.id, c]));
	const scheduleById = new Map(input.schedules.map((s) => [s.id, s]));
	const live = input.txns.filter((t) => !t.isDeleted).sort(oldestFirst);

	return {
		name: 'Záznamy',
		header: head([
			'Datum',
			'Účet',
			'Kategorie',
			'Popis',
			'Částka',
			'Měna',
			'Typ',
			'Jednorázový',
			'Blokace',
			'Dluží mi',
			'Kdo',
			'Vyrovnáno',
			'Zdroj',
			'Pravidelná platba',
			'Poznámka'
		]),
		rows: live.map((t) => {
			const category = t.categoryId === null ? null : (byId.get(t.categoryId) ?? null);
			const shares = sharesOf(t);
			const owed = sum(shares.map((s) => abs(s.amount)));
			const settled = shares.filter((s) => s.settledByTxnId !== null).length;
			const schedule = t.scheduleId ? scheduleById.get(t.scheduleId) : undefined;
			return [
				{ date: t.date },
				accountById.get(t.accountId)?.name ?? '',
				category?.name ?? 'bez kategorie',
				t.payee,
				{ money: t.amount },
				accountById.get(t.accountId)?.currency ?? '',
				category ? (category.isIncome ? 'příjem' : SPEND_TYPE_LABEL[category.spendType]) : '',
				yes(t.isOneOff),
				yes(Boolean(t.isProvisional)),
				owed > 0 ? { money: owed } : null,
				shares.map((s) => s.who.trim() || 'někdo').join(', '),
				shares.length === 0
					? ''
					: settled === shares.length
						? 'ano'
						: settled > 0
							? 'zčásti'
							: 'ne',
				isTransfer(t) ? 'směna' : SOURCE_LABEL[t.source],
				schedule?.payee ?? '',
				t.note ?? ''
			];
		}),
		widths: [11, 16, 18, 30, 14, 7, 10, 12, 9, 12, 18, 11, 16, 20, 30]
	};
}

function receivablesSheet(input: WorkbookInput, accountById: ReadonlyMap<string, Account>): Sheet {
	const entries = input.txns
		.filter((t) => !t.isDeleted)
		.flatMap((txn) => sharesOf(txn).map((share) => ({ txn, share })))
		.filter(({ share }) => share.amount !== 0)
		// Open ones first, the oldest of them at the top: that is the one to chase.
		.sort((a, b) => {
			const open =
				Number(a.share.settledByTxnId !== null) - Number(b.share.settledByTxnId !== null);
			return open || oldestFirst(a.txn, b.txn);
		});

	return {
		name: 'Pohledávky',
		header: head(['Datum', 'Za co', 'Kdo', 'Dluží', 'Z výdaje', 'Měna', 'Účet', 'Vráceno']),
		rows: entries.map(({ txn, share }) => {
			const account = accountById.get(txn.accountId);
			return [
				{ date: txn.date },
				txn.payee || txn.note || 'bez popisu',
				share.who.trim() || 'někdo',
				{ money: abs(share.amount) },
				{ money: abs(txn.amount) },
				account?.currency ?? '',
				account?.name ?? '',
				share.settledByTxnId === null ? 'ne' : 'ano'
			];
		}),
		widths: [11, 30, 18, 14, 14, 7, 16, 9]
	};
}

function schedulesSheet(input: WorkbookInput, accountById: ReadonlyMap<string, Account>): Sheet {
	const byId = new Map(input.categories.map((c) => [c.id, c]));
	const fallback = input.activeAccountId ?? '';
	const live = input.schedules
		.filter((s) => !s.isDeleted && !s.isArchived)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.dayOfMonth - b.dayOfMonth);

	return {
		name: 'Pravidelné platby',
		header: head([
			'Účet',
			'Co',
			'Kategorie',
			'Směr',
			'Za měsíc',
			'Za rok',
			'Vrací se za měsíc',
			'Kdo',
			'Stojí tě za rok',
			'Měna',
			'Den',
			'Od',
			'Do',
			'Zápis'
		]),
		rows: live.map((s) => {
			const account = accountById.get(s.accountId || fallback);
			const shares = scheduleSharesOf(s);
			const back = sum(shares.map((share) => abs(share.amount)));
			const incoming = s.amount > 0;
			return [
				account?.name ?? '',
				s.payee,
				byId.get(s.categoryId)?.name ?? '',
				incoming ? 'přichází' : 'odchází',
				{ money: abs(s.amount) },
				{ money: minor(abs(s.amount) * 12) },
				back > 0 ? { money: back } : null,
				shares.map((share) => share.who.trim() || 'někdo').join(', '),
				incoming ? null : { money: minor(netOfSchedule(s) * 12) },
				account?.currency ?? '',
				s.dayOfMonth,
				s.startMonth,
				s.endMonth ?? '',
				MODE_LABEL[s.mode]
			];
		}),
		widths: [16, 24, 16, 10, 12, 12, 16, 18, 14, 7, 6, 10, 10, 12]
	};
}

function goalSheets(input: WorkbookInput): Sheet[] {
	const byId = new Map(input.categories.map((c) => [c.id, c]));
	const live = input.goals.filter((g) => !g.isDeleted);
	const targets = input.monthTargets.filter((t) => !t.isDeleted);
	const month = monthKey(input.today);

	const goals: Sheet = {
		name: 'Cíle',
		header: head([
			'Cíl',
			'Proč',
			'Cílová částka',
			'Termín',
			'Počítá se od',
			'Kategorie',
			'Naspořeno',
			'Zbývá',
			'Hotovo %',
			'Měsíčně potřeba',
			'Tento měsíc cíl',
			'Tento měsíc odloženo',
			'Stav'
		]),
		rows: live.map((goal) => {
			const status = goalStatus({
				goal,
				txns: input.txns,
				categories: input.categories,
				target: targetsByMonth(targets.filter((t) => t.goalId === goal.id)).get(month) ?? null,
				month,
				today: input.today
			});
			return [
				goal.name,
				goal.why,
				{ money: goal.targetAmount },
				{ date: goal.targetDate },
				{ date: goal.startDate },
				goal.categoryId ? (byId.get(goal.categoryId)?.name ?? '') : 'všechno spoření',
				{ money: status.saved },
				{ money: status.remaining },
				status.percent,
				{ money: status.suggestedMonthly },
				{ money: status.monthTarget },
				{ money: status.monthSaved },
				status.isComplete ? 'splněno' : status.isOverdue ? 'po termínu' : 'běží'
			];
		}),
		widths: [22, 40, 14, 11, 12, 16, 14, 14, 10, 16, 16, 18, 12]
	};

	const record: Sheet = {
		name: 'Cíle po měsících',
		header: head(['Cíl', 'Měsíc', 'Cíl měsíce', 'Odloženo', 'Splněno']),
		rows: live.flatMap((goal) =>
			monthHistory(goal, input.txns, input.categories, targets, input.today)
				.reverse()
				.map((row) => [
					goal.name,
					monthName(row.month),
					row.target === null ? null : { money: row.target },
					{ money: row.saved },
					row.target === null ? '' : row.met ? 'ano' : 'ne'
				])
		),
		widths: [22, 14, 14, 14, 9]
	};

	return [goals, record];
}

function accountsSheet(input: WorkbookInput): Sheet {
	const live = input.accounts.filter((a) => !a.isDeleted).sort((a, b) => a.sortOrder - b.sortOrder);
	return {
		name: 'Účty',
		header: head([
			'Účet',
			'Druh',
			'Měna',
			'Počáteční zůstatek',
			'Od',
			'Zůstatek dnes',
			'Archivovaný'
		]),
		rows: live.map((account) => [
			account.name,
			ACCOUNT_KIND_LABEL[account.kind] ?? '',
			account.currency,
			{ money: openingTotal(account) },
			{ date: account.openingDate },
			{
				money: balanceOf(
					openingTotal(account),
					input.txns.filter((t) => !t.isDeleted && t.accountId === account.id)
				)
			},
			yes(account.isArchived)
		]),
		widths: [20, 16, 7, 18, 11, 16, 12]
	};
}

function wealthSheet(input: WorkbookInput): Sheet {
	return {
		name: 'Jmění',
		header: head(['Investice', 'Druh', 'Měna', 'Datum hodnoty', 'Hodnota', 'Poznámka']),
		rows: input.holdings
			.filter((h) => !h.isDeleted && !h.isArchived)
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.flatMap((h) =>
				input.valuations
					.filter((v) => !v.isDeleted && v.holdingId === h.id)
					.sort((a, b) => a.date.localeCompare(b.date))
					.map((v) => [
						h.name,
						KIND_LABEL[h.kind],
						h.currency,
						{ date: v.date },
						{ money: v.value },
						v.note ?? ''
					])
			),
		widths: [22, 14, 7, 14, 14, 30]
	};
}

function plansSheet(input: WorkbookInput, accountById: ReadonlyMap<string, Account>): Sheet {
	return {
		name: 'Plány',
		header: head(['Plán', 'Účet', 'Položka', 'Směr', 'Druh', 'Částka', 'Vrací se', 'Čistě']),
		rows: input.plans
			.filter((p) => !p.isDeleted)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
			.flatMap((plan) =>
				plan.lines.map((line) => [
					plan.name,
					accountById.get(plan.accountId)?.name ?? '',
					line.name,
					line.kind === 'income' ? 'příjem' : 'výdaj',
					line.kind === 'income' ? '' : SPEND_TYPE_LABEL[line.spendType],
					{ money: abs(line.amount) },
					line.paidBack > 0 ? { money: line.paidBack } : null,
					{ money: lineNet(line) }
				])
			),
		widths: [20, 16, 24, 8, 10, 14, 12, 14]
	};
}

function categoriesSheet(input: WorkbookInput): Sheet {
	return {
		name: 'Kategorie',
		header: head(['Kategorie', 'Směr', 'Typ', 'Měsíční strop', 'Archivovaná']),
		rows: input.categories
			.filter((c) => !c.isDeleted)
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((c) => [
				c.name,
				c.isIncome ? 'příjem' : 'výdaj',
				c.isIncome ? '' : SPEND_TYPE_LABEL[c.spendType],
				c.monthlyCap === null ? null : { money: c.monthlyCap },
				yes(c.isArchived)
			]),
		widths: [20, 8, 10, 14, 12]
	};
}

// ── the workbook ────────────────────────────────────────────────────────────

export interface Workbook {
	sheets: Sheet[];
	/** The tab it opens on: the latest month of the account the app is on. */
	activeSheet: number;
	/** Live rows written, for the toast. */
	rowCount: number;
}

export function buildWorkbook(input: WorkbookInput): Workbook {
	const byId = new Map(input.categories.map((c) => [c.id, c]));
	const accountById = new Map(input.accounts.map((a) => [a.id, a]));
	const live = input.txns.filter((t) => !t.isDeleted);

	// Every account with rows, the one the app is on first; an empty ledger
	// still gets its template, for this month, so the file is never blank.
	const accounts = input.accounts
		.filter((a) => !a.isDeleted)
		.sort(
			(a, b) =>
				Number(b.id === input.activeAccountId) - Number(a.id === input.activeAccountId) ||
				a.sortOrder - b.sortOrder
		);
	let exported = accounts.filter((a) => live.some((t) => t.accountId === a.id));
	if (exported.length === 0 && accounts[0]) exported = [accounts[0]];
	const suffix = (account: Account) => (exported.length > 1 ? ` · ${account.name}` : '');

	const sheets: Sheet[] = [];
	let activeSheet = 0;

	exported.forEach((account, index) => {
		const rows = live.filter((t) => t.accountId === account.id);
		const covered = [...new Set(rows.map((t) => monthKey(t.date)))].sort();
		const months = covered.length > 0 ? covered : [monthKey(input.today)];
		const columns = columnsFor(rows, input.categories);

		const summaries = months.map((month) =>
			summariseMonth({ month, txns: rows, categories: [...input.categories], today: input.today })
		);

		months.forEach((month, m) => {
			sheets.push(
				monthSheet({
					name: `${monthName(month)}${suffix(account)}`,
					rows: rows.filter((t) => monthKey(t.date) === month),
					columns,
					summary: summaries[m]!,
					byId,
					code: account.currency
				})
			);
		});
		if (index === 0) activeSheet = sheets.length - 1;

		sheets.push(
			sumaSheet({
				name: `SUMA${suffix(account)}`,
				months,
				summaries,
				rows,
				columns,
				byId,
				allTxns: live,
				today: input.today
			})
		);
	});

	sheets.push(
		ledgerSheet(input, accountById),
		receivablesSheet(input, accountById),
		schedulesSheet(input, accountById),
		...goalSheets(input),
		accountsSheet(input),
		wealthSheet(input),
		plansSheet(input, accountById),
		categoriesSheet(input)
	);

	return { sheets, activeSheet, rowCount: live.length };
}
