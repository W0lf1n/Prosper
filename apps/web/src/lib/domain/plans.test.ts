import { describe, expect, it } from 'vitest';
import {
	MAX_PLAN_LINES,
	cleanLines,
	defaultPlanName,
	lineNet,
	linesFromSchedules,
	planVerdict,
	summarisePlan
} from './plans';
import { formatMoney, minor } from './money';
import type { Category, PlanLine, Schedule, SpendType } from './types';

const SYNCED = { updatedAt: '2026-09-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };

let seq = 0;
function line(patch: Partial<PlanLine> & Pick<PlanLine, 'kind' | 'amount'>): PlanLine {
	seq += 1;
	return {
		id: `l${seq}`,
		name: `řádek ${seq}`,
		spendType: 'need',
		paidBack: minor(0),
		...patch
	};
}

const income = (amount: number, name = 'Výplata') =>
	line({ kind: 'income', amount: minor(amount), name });
const expense = (amount: number, spendType: SpendType = 'need', paidBack = 0, name = 'výdaj') =>
	line({ kind: 'expense', amount: minor(amount), spendType, paidBack: minor(paidBack), name });

function category(id: string, spendType: SpendType): Category {
	return {
		id,
		parentId: null,
		name: id,
		spendType,
		monthlyCap: null,
		sortOrder: 0,
		isArchived: false,
		isIncome: false,
		icon: 'tag',
		color: 'stone',
		...SYNCED
	};
}

function schedule(patch: Partial<Schedule> & Pick<Schedule, 'payee' | 'amount'>): Schedule {
	seq += 1;
	return {
		id: `s${seq}`,
		accountId: 'acc',
		categoryId: 'cat-need',
		dayOfMonth: 1,
		startMonth: '2026-01',
		endMonth: null,
		mode: 'auto',
		shares: [],
		lastPostedMonth: null,
		isArchived: false,
		sortOrder: seq,
		...SYNCED,
		...patch
	};
}

describe('lineNet — what a line costs you', () => {
	it('takes what comes back off an expense, and never below zero', () => {
		expect(lineNet(expense(2800000, 'debt', 1400000))).toBe(1400000);
		expect(lineNet(expense(100000, 'need', 250000))).toBe(0);
		expect(lineNet(expense(100000, 'need', -5))).toBe(100000);
	});

	it('counts an income whole', () => {
		expect(lineNet(income(4000000))).toBe(4000000);
	});
});

describe('summarisePlan — pro mě', () => {
	// The case the feature was asked for: 40 000 in, a 28 000 mortgage of
	// which the roommate pays 14 000.
	const lines = [income(4000000), expense(2800000, 'debt', 1400000, 'Hypotéka')];

	it('says what the month costs you, and what that leaves', () => {
		const s = summarisePlan({ lines, days: 30 });
		expect(s.income).toBe(4000000);
		expect(s.gross).toBe(2800000);
		expect(s.paidBack).toBe(1400000);
		expect(s.committed).toBe(1400000);
		expect(s.left).toBe(2600000);
		expect(s.leftPercent).toBe(65);
		expect(s.perDay).toBe(86667);
	});

	it('reads the lines in the book’s four classes, net of what comes back', () => {
		const s = summarisePlan({
			lines: [
				...lines,
				expense(400000, 'save', 0, 'Spoření'),
				expense(200000, 'give', 0, 'Dary'),
				expense(600000, 'need', 0, 'Potraviny'),
				expense(150000, 'want', 0, 'Netflix')
			],
			days: 30
		});
		expect(s.classes.map((c) => [c.cls, c.amount, c.percent, c.delta])).toEqual([
			['give', 200000, 5, -5],
			['save', 400000, 10, 0],
			['debt', 1400000, 35, 25],
			['live', 750000, 19, -51]
		]);
		expect(s.need).toBe(600000);
		expect(s.want).toBe(150000);
		expect(s.classes[0]!.targetAmount).toBe(400000);
		expect(s.weakest?.cls).toBe('give');
	});

	it('goes negative when the plan spends more than comes in', () => {
		const s = summarisePlan({ lines: [income(1000000), expense(1500000)], days: 31 });
		expect(s.left).toBe(-500000);
		expect(s.leftPercent).toBe(-50);
		expect(s.perDay).toBeNull();
	});

	it('has nothing to say without an income', () => {
		const s = summarisePlan({ lines: [expense(500000)], days: 31 });
		expect(s.hasIncome).toBe(false);
		expect(s.classes.every((c) => c.percent === 0 && c.delta === 0)).toBe(true);
		expect(s.classes.every((c) => c.targetAmount === 0)).toBe(true);
		expect(s.weakest).toBeNull();
	});
});

describe('planVerdict', () => {
	it('names the one decision most worth fixing, with the book’s figure', () => {
		const s = summarisePlan({
			lines: [
				income(4000000),
				expense(200000, 'give'),
				expense(400000, 'save'),
				expense(400000, 'debt')
			],
			days: 30
		});
		// The figure goes through `formatMoney`, whose spaces are Intl's, not the keyboard's.
		expect(planVerdict(s)).toBe(
			`Dávání: 5 % místo 10 %. Kniha by sem z tohohle příjmu dala ${formatMoney(minor(400000))}.`
		);
		expect(planVerdict(s, 'EUR')).toContain(formatMoney(minor(400000), { code: 'EUR' }));
	});

	it('says when the three sit, when the plan overspends, and when there is nothing', () => {
		const fine = summarisePlan({
			lines: [
				income(4000000),
				expense(400000, 'give'),
				expense(400000, 'save'),
				expense(400000, 'debt')
			],
			days: 30
		});
		expect(planVerdict(fine)).toBe('Tři podíly sedí. Pro tebe zbývá 70 % příjmu.');
		expect(planVerdict(summarisePlan({ lines: [income(100000), expense(150000)], days: 30 }))).toBe(
			'Závazky jsou o 50 % vyšší než příjem.'
		);
		expect(planVerdict(summarisePlan({ lines: [], days: 30 }))).toBe(
			'Bez příjmu není co rozdělovat.'
		);
	});
});

describe('cleanLines — what may be saved', () => {
	it('drops a line nobody filled in and keeps one with only a figure', () => {
		const kept = cleanLines([
			line({ kind: 'expense', amount: minor(0), name: '  ' }),
			line({ kind: 'expense', amount: minor(500), name: '' }),
			line({ kind: 'income', amount: minor(0), name: 'Brigáda' })
		]);
		expect(kept.map((l) => [l.name, l.amount])).toEqual([
			['', 500],
			['Brigáda', 0]
		]);
	});

	it('clamps what comes back to the line, strips it off an income, and trims the name', () => {
		const [rent, pay] = cleanLines([
			expense(100000, 'want', 250000, '  Nájem '),
			line({ kind: 'income', amount: minor(-4000000), name: 'Výplata', paidBack: minor(99) })
		]);
		expect(rent).toMatchObject({
			name: 'Nájem',
			amount: 100000,
			paidBack: 100000,
			spendType: 'want'
		});
		expect(pay).toMatchObject({ amount: 4000000, paidBack: 0, spendType: 'need' });
	});

	it('stops at the ceiling', () => {
		const many = Array.from({ length: MAX_PLAN_LINES + 5 }, () => expense(100));
		expect(cleanLines(many)).toHaveLength(MAX_PLAN_LINES);
	});
});

describe('linesFromSchedules — a plan that starts from the standing orders', () => {
	const categories = [category('cat-need', 'need'), category('cat-debt', 'debt')];

	it('carries the amount, the bucket’s class and the shares that come back', () => {
		let n = 0;
		const lines = linesFromSchedules({
			schedules: [
				schedule({
					payee: 'Hypotéka',
					amount: minor(-2800000),
					categoryId: 'cat-debt',
					shares: [{ id: 'sh1', who: 'Honza', amount: minor(1400000) }],
					sortOrder: 2
				}),
				schedule({ payee: 'Výplata', amount: minor(4000000), sortOrder: 1 }),
				schedule({ payee: 'Stará', amount: minor(-100), isArchived: true }),
				schedule({ payee: 'Smazaná', amount: minor(-100), isDeleted: true }),
				schedule({ payee: 'Cizí', amount: minor(-100), accountId: 'other' })
			],
			categories,
			accountId: 'acc',
			id: () => `id${++n}`
		});
		expect(lines).toEqual([
			{
				id: 'id1',
				kind: 'income',
				name: 'Výplata',
				amount: 4000000,
				spendType: 'need',
				paidBack: 0
			},
			{
				id: 'id2',
				kind: 'expense',
				name: 'Hypotéka',
				amount: 2800000,
				spendType: 'debt',
				paidBack: 1400000
			}
		]);
	});

	it('takes a schedule with no account for any plan, and an unknown bucket as need', () => {
		const lines = linesFromSchedules({
			schedules: [
				schedule({ payee: 'Bez účtu', amount: minor(-500), accountId: '', categoryId: 'gone' })
			],
			categories,
			accountId: 'acc'
		});
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ name: 'Bez účtu', spendType: 'need', paidBack: 0 });
		expect(lines[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
	});
});

describe('defaultPlanName', () => {
	it('names the month, in Czech', () => {
		expect(defaultPlanName('2026-09-09')).toBe('Plán · září 2026');
	});
});
