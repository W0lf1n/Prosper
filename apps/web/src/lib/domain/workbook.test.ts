import { describe, expect, it } from 'vitest';
import { summariseMonth } from './checks';
import { minor, type Minor } from './money';
import type { Account, Category, Txn } from './types';
import { buildWorkbook, type WorkbookInput } from './workbook';
import type { Cell, CellValue, Sheet } from './xlsx';

const SYNCED = { updatedAt: '2026-08-01T10:00:00.000Z', deviceId: 'dev-1', isDeleted: false };

function category(name: string, sortOrder: number, extra: Partial<Category> = {}): Category {
	return {
		id: `cat-${name}`,
		parentId: null,
		name,
		spendType: 'need',
		monthlyCap: null,
		sortOrder,
		isArchived: false,
		isIncome: false,
		icon: 'tag',
		color: 'stone',
		...SYNCED,
		...extra
	};
}

function account(id: string, extra: Partial<Account> = {}): Account {
	return {
		id,
		name: id,
		kind: 'checking',
		openingBalance: minor(0),
		openingDate: '2026-01-01',
		currency: 'CZK',
		pockets: [],
		isArchived: false,
		sortOrder: 0,
		...SYNCED,
		...extra
	};
}

let seq = 0;
function txn(
	date: string,
	amount: number,
	categoryId: string | null,
	extra: Partial<Txn> = {}
): Txn {
	seq += 1;
	return {
		id: `txn-${seq}`,
		accountId: 'kb',
		date,
		amount: minor(amount),
		categoryId,
		payee: '',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		isProvisional: false,
		shares: [],
		scheduleId: null,
		createdAt: `${date}T10:00:00.000Z`,
		...SYNCED,
		...extra
	};
}

const CATEGORIES = [
	category('PŘÍJEM', 0, { isIncome: true }),
	category('DARY', 1, { spendType: 'give' }),
	category('JÍDLO', 2),
	category('BYDLENÍ', 3),
	category('STARÉ', 4, { isArchived: true })
];

function input(txns: Txn[], extra: Partial<WorkbookInput> = {}): WorkbookInput {
	return {
		accounts: [account('kb')],
		txns,
		categories: CATEGORIES,
		schedules: [],
		goals: [],
		monthTargets: [],
		holdings: [],
		valuations: [],
		plans: [],
		activeAccountId: 'kb',
		today: '2026-09-29',
		...extra
	};
}

/** The value inside a cell, whether it was written styled or bare. */
function valueOf(cell: Cell | undefined): CellValue | undefined {
	return cell !== null && typeof cell === 'object' && 'style' in cell ? cell.value : cell;
}

function text(cell: Cell | undefined): string {
	return String(valueOf(cell) ?? '');
}

function money(cell: Cell | undefined): Minor | null {
	const value = valueOf(cell);
	return value && typeof value === 'object' && 'money' in value ? value.money : null;
}

function formula(cell: Cell | undefined): string | undefined {
	const value = valueOf(cell);
	return value && typeof value === 'object' && 'money' in value ? value.formula : undefined;
}

const sheetNamed = (sheets: Sheet[], name: string) => sheets.find((s) => s.name === name)!;

const LEDGER = [
	txn('2026-08-01', 3_000_000, 'cat-PŘÍJEM', { payee: 'výplata' }),
	txn('2026-08-03', -120_000, 'cat-JÍDLO', {
		payee: 'Lidl',
		shares: [{ id: 's1', who: 'Bea', amount: minor(60_000), settledByTxnId: null }]
	}),
	txn('2026-08-05', -2_500_000, 'cat-BYDLENÍ', { payee: 'dveře', isOneOff: true }),
	txn('2026-08-06', 5_000, 'cat-JÍDLO', { payee: 'vratka' }),
	txn('2026-09-02', -40_000, 'cat-JÍDLO', { payee: 'Albert', isProvisional: true }),
	txn('2026-09-10', -1_000, null, { payee: 'něco' })
];

describe('the month sheets — the template', () => {
	const { sheets } = buildWorkbook(input(LEDGER));
	const august = sheetNamed(sheets, 'Srpen 2026');

	it('is one sheet per month, then SUMA, then the tables', () => {
		expect(sheets.map((s) => s.name).slice(0, 4)).toEqual([
			'Srpen 2026',
			'Září 2026',
			'SUMA',
			'Záznamy'
		]);
	});

	it('pairs every live bucket with its popis, income first, CELKEM and VÝDAJE at the end', () => {
		expect(august.header.slice(0, 12).map(text)).toEqual([
			'PŘÍJEM',
			'popis',
			'DARY',
			'popis',
			'JÍDLO',
			'popis',
			'BYDLENÍ',
			'popis',
			'BEZ KATEGORIE',
			'popis',
			'CELKEM',
			'VÝDAJE'
		]);
		// An archived bucket with no rows is not a column.
		expect(august.header.map(text)).not.toContain('STARÉ');
	});

	it('totals each bucket in the second row, and CELKEM is the month net on Přehled', () => {
		const totals = august.rows[0]!;
		const summary = summariseMonth({
			month: '2026-08',
			txns: LEDGER,
			categories: CATEGORIES,
			today: '2026-09-29'
		});

		expect(money(totals[0])).toBe(3_000_000); // PŘÍJEM
		expect(money(totals[2])).toBe(0); // DARY, unused, still there
		expect(money(totals[4])).toBe(115_000); // JÍDLO less the refund
		expect(money(totals[6])).toBe(2_500_000); // BYDLENÍ
		expect(money(totals[8])).toBe(0); // BEZ KATEGORIE, empty in August
		expect(money(totals[10])).toBe(summary.net);
		expect(money(totals[11])).toBe(-summary.outflow);
	});

	it('writes the totals as formulas, so the sheet still adds up when edited', () => {
		const totals = august.rows[0]!;
		expect(formula(totals[4])).toBe('SUM(E3:E4)');
		expect(formula(totals[10])).toBe('A2-L2');
		expect(formula(totals[11])).toBe('C2+E2+G2+I2');
	});

	it('nets a refund against its bucket as a negative cost', () => {
		const jidlo = august.rows.slice(1).map((row) => money(row[4]));
		expect(jidlo).toEqual([120_000, -5_000]);
	});

	it('puts the date and the flags into the popis', () => {
		const popis = august.rows.slice(1).map((row) => text(row[5]));
		expect(popis[0]).toMatch(/^3\. 8\. Lidl · dluží Bea 600,00\sKč$/);
		expect(text(august.rows[1]![7])).toBe('5. 8. dveře · jednorázový');
	});

	it('carries one-off, the running cost and what comes back beside the totals', () => {
		const totals = august.rows[0]!;
		expect(august.header.slice(12).map(text)).toEqual(['JEDNORÁZOVÉ', 'BĚŽNÝ CHOD', 'VRACÍ SE']);
		expect(money(totals[12])).toBe(2_500_000);
		expect(money(totals[13])).toBe(115_000);
		expect(money(totals[14])).toBe(60_000);
	});

	it('gives the unfiled rows their own pair, on every month of the account so they line up', () => {
		const september = sheetNamed(sheets, 'Září 2026');
		const titles = september.header.map(text);
		expect(titles).toContain('BEZ KATEGORIE');
		expect(text(september.rows[1]![titles.indexOf('BEZ KATEGORIE') + 1])).toBe('10. 9. něco');
		expect(august.header.map(text)).toEqual(titles);
	});

	it('opens on the latest month', () => {
		const workbook = buildWorkbook(input(LEDGER));
		expect(workbook.sheets[workbook.activeSheet]!.name).toBe('Září 2026');
	});
});

describe('SUMA', () => {
	const suma = sheetNamed(buildWorkbook(input(LEDGER)).sheets, 'SUMA');

	it('has one row per month under a total and an average', () => {
		expect(suma.rows.map((row) => text(row[0]))).toEqual([
			'CELKEM',
			'PRŮMĚR',
			'Srpen 2026',
			'Září 2026'
		]);
	});

	it('totals the period by formula over the month rows', () => {
		expect(money(suma.rows[0]![1])).toBe(3_000_000);
		expect(formula(suma.rows[0]![1])).toBe('SUM(B4:B5)');
		expect(money(suma.rows[1]![1])).toBe(1_500_000);
	});

	it('adds the quiet days and the split after the money', () => {
		const titles = suma.header.map(text);
		expect(titles).toContain('DNY BEZ VÝDAJE');
		expect(titles.slice(-5)).toEqual([
			'Dávání %',
			'Spoření %',
			'Dluh a rezerva %',
			'Život %',
			'Zbývá %'
		]);
	});
});

describe('accounts', () => {
	it('never sums two accounts: each gets its own months and SUMA', () => {
		const accounts = [account('kb'), account('revolut', { currency: 'EUR', sortOrder: 1 })];
		const txns = [...LEDGER, txn('2026-09-12', -2_000, 'cat-JÍDLO', { accountId: 'revolut' })];
		const names = buildWorkbook(input(txns, { accounts })).sheets.map((s) => s.name);

		expect(names).toContain('Září 2026 · kb');
		expect(names).toContain('Září 2026 · revolut');
		expect(names).toContain('SUMA · kb');
		expect(names).toContain('SUMA · revolut');
	});

	it('leaves a move out of every column, and names it in Záznamy (Q83)', () => {
		// Cash out of the ATM: no bucket on either leg, so no column, and the
		// month's CELKEM stays the Přehled net it was without it.
		const accounts = [account('kb'), account('cash', { kind: 'cash', sortOrder: 1 })];
		const out = txn('2026-08-07', -200_000, null, {
			payee: 'Převod → cash',
			transferPairId: 'leg-in'
		});
		const arrived = txn('2026-08-07', 200_000, null, {
			id: 'leg-in',
			accountId: 'cash',
			payee: 'Převod ← kb',
			transferPairId: out.id
		});
		const { sheets } = buildWorkbook(input([...LEDGER, out, arrived], { accounts }));
		const august = sheetNamed(sheets, 'Srpen 2026 · kb');
		const plain = sheetNamed(buildWorkbook(input(LEDGER)).sheets, 'Srpen 2026');

		expect(august.header.map(text)).toEqual(plain.header.map(text));
		expect(august.rows[0]!.map(money)).toEqual(plain.rows[0]!.map(money));
		const ledger = sheetNamed(sheets, 'Záznamy');
		const row = ledger.rows.find((r) => text(r[3]) === 'Převod → cash')!;
		expect(text(row[2])).toBe('převod');
		expect(text(row[12])).toBe('převod');
	});

	it('puts the account the app is on first', () => {
		const accounts = [account('kb'), account('revolut', { currency: 'EUR', sortOrder: 1 })];
		const txns = [...LEDGER, txn('2026-09-12', -2_000, 'cat-JÍDLO', { accountId: 'revolut' })];
		const workbook = buildWorkbook(input(txns, { accounts, activeAccountId: 'revolut' }));

		expect(workbook.sheets[0]!.name).toBe('Září 2026 · revolut');
		expect(workbook.sheets[workbook.activeSheet]!.name).toBe('Září 2026 · revolut');
	});
});

describe('an empty ledger', () => {
	it('still gets the template, for this month', () => {
		const { sheets, rowCount } = buildWorkbook(input([]));
		expect(sheets[0]!.name).toBe('Září 2026');
		expect(text(sheets[0]!.header[0])).toBe('PŘÍJEM');
		expect(rowCount).toBe(0);
	});
});

describe('the tables', () => {
	it('lists every share in Pohledávky, the open ones first', () => {
		const settled = txn('2026-07-01', -10_000, 'cat-JÍDLO', {
			payee: 'pizza',
			shares: [{ id: 's2', who: 'Adam', amount: minor(5_000), settledByTxnId: 'x' }]
		});
		const sheet = sheetNamed(buildWorkbook(input([...LEDGER, settled])).sheets, 'Pohledávky');

		expect(sheet.rows.map((row) => [text(row[2]), text(row[7])])).toEqual([
			['Bea', 'ne'],
			['Adam', 'ano']
		]);
	});

	it('leaves the deleted rows out of Záznamy', () => {
		const gone = txn('2026-09-11', -99_900, 'cat-JÍDLO', { isDeleted: true });
		const workbook = buildWorkbook(input([...LEDGER, gone]));

		expect(sheetNamed(workbook.sheets, 'Záznamy').rows).toHaveLength(LEDGER.length);
		expect(workbook.rowCount).toBe(LEDGER.length);
	});
});
