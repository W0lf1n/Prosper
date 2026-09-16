import { describe, expect, it } from 'vitest';

import { seedCategories } from '$lib/db/seed';
import { addDays } from './datetime';
import { DEMO_DAYS, demoLedger } from './demo';

const TODAY = '2026-09-16';

describe('the demo ledger', () => {
	it('is the same ledger every time the same day opens it', () => {
		expect(demoLedger(TODAY)).toEqual(demoLedger(TODAY));
	});

	it('moves with the day it is opened on', () => {
		const a = demoLedger('2026-09-16');
		const b = demoLedger('2026-11-03');
		expect(b.openingDate).toBe(addDays('2026-11-03', -(DEMO_DAYS + 1)));
		expect(a.txns[a.txns.length - 1]!.date).toBe('2026-09-16');
		expect(b.txns[b.txns.length - 1]!.date).toBe('2026-11-03');
	});

	it('stays between the opening day and today, whole haléře, never zero', () => {
		const ledger = demoLedger(TODAY);
		expect(ledger.txns.length).toBeGreaterThan(60);
		for (const txn of ledger.txns) {
			expect(txn.date >= ledger.openingDate && txn.date <= TODAY).toBe(true);
			expect(Number.isSafeInteger(txn.amount)).toBe(true);
			expect(txn.amount).not.toBe(0);
		}
	});

	it('only names buckets the seed knows, and income only on the income one', () => {
		const known = new Map(seedCategories().map((c) => [c.name, c.isIncome === true]));
		const ledger = demoLedger(TODAY);
		for (const txn of ledger.txns) {
			expect(known.has(txn.category)).toBe(true);
			expect(txn.amount > 0).toBe(known.get(txn.category));
		}
		for (const schedule of ledger.schedules) expect(known.has(schedule.category)).toBe(true);
		expect(known.has(ledger.goal.category)).toBe(true);
	});

	it('has one row wearing each of the three chips, and the shares never exceed the row', () => {
		const ledger = demoLedger(TODAY);
		expect(ledger.txns.filter((t) => t.isOneOff)).toHaveLength(1);
		expect(ledger.txns.filter((t) => t.isProvisional)).toHaveLength(1);
		const shared = ledger.txns.filter((t) => t.shares?.length);
		expect(shared).toHaveLength(1);
		const total = shared[0]!.shares!.reduce((sum, s) => sum + s.amount, 0);
		expect(total).toBeLessThanOrEqual(-shared[0]!.amount);
	});

	it('leaves this month’s rent and Netflix to the schedules, so the deck has something to ask', () => {
		const ledger = demoLedger(TODAY);
		const thisMonth = ledger.txns.filter((t) => t.date.startsWith('2026-09'));
		expect(thisMonth.some((t) => t.payee === 'nájem')).toBe(false);
		expect(thisMonth.some((t) => t.payee === 'Netflix')).toBe(false);
		expect(ledger.txns.some((t) => t.date === '2026-08-01' && t.payee === 'nájem')).toBe(true);
		expect(ledger.schedules.filter((s) => s.mode === 'confirm').map((s) => s.payee)).toEqual([
			'nájem',
			'Netflix'
		]);
	});

	it('writes a goal the form would accept and a holding valued in order', () => {
		const ledger = demoLedger(TODAY);
		expect(ledger.goal.why.length).toBeGreaterThanOrEqual(10);
		expect(ledger.goal.targetDate > TODAY).toBe(true);
		expect(ledger.goal.targetAmount).toBeGreaterThan(ledger.goal.startAmount);
		const dates = ledger.holding.valuations.map((v) => v.date);
		expect([...dates].sort()).toEqual(dates);
		expect(dates[dates.length - 1]! <= TODAY).toBe(true);
	});
});
