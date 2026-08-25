import { describe, expect, it } from 'vitest';
import {
	currentValuation,
	readHolding,
	readHoldings,
	valuationWarning,
	wealthTotal
} from './holdings';
import { summariseMonth } from './checks';
import { prosperitySplit } from './prosperity';
import { minor, type Minor } from './money';
import type { Category, Holding, Txn, Valuation } from './types';

const SYNCED = { updatedAt: '2026-08-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };

function holding(id: string, patch: Partial<Holding> = {}): Holding {
	return {
		id,
		name: id,
		kind: 'investment',
		currency: 'CZK',
		categoryId: null,
		reminderDays: 30,
		isArchived: false,
		sortOrder: 0,
		...SYNCED,
		...patch
	};
}

function valuation(
	id: string,
	holdingId: string,
	date: string,
	value: number,
	patch: Partial<Valuation> = {}
): Valuation {
	return {
		id,
		holdingId,
		date,
		value: minor(value),
		note: null,
		createdAt: `${date}T09:00:00.000Z`,
		...SYNCED,
		...patch
	};
}

const TODAY = '2026-08-25';

describe('currentValuation', () => {
	it('is null when there is nothing to read', () => {
		expect(currentValuation([])).toBeNull();
	});

	it('takes the greatest date, not the last row', () => {
		const rows = [
			valuation('a', 'h', '2026-06-01', 100_00),
			valuation('c', 'h', '2026-08-01', 300_00),
			valuation('b', 'h', '2026-07-01', 200_00)
		];
		expect(currentValuation(rows)?.id).toBe('c');
	});

	it('breaks a same-date tie on createdAt — the correction wins', () => {
		const wrong = valuation('wrong', 'h', '2026-08-20', 4_120_000_00, {
			createdAt: '2026-08-20T09:00:00.000Z'
		});
		const fixed = valuation('fixed', 'h', '2026-08-20', 412_000_00, {
			createdAt: '2026-08-20T09:00:41.000Z'
		});
		expect(currentValuation([wrong, fixed])?.id).toBe('fixed');
		expect(currentValuation([fixed, wrong])?.id).toBe('fixed');
	});

	it('ignores soft-deleted readings', () => {
		const rows = [
			valuation('old', 'h', '2026-07-01', 200_00),
			valuation('binned', 'h', '2026-08-01', 999_00, { isDeleted: true })
		];
		expect(currentValuation(rows)?.id).toBe('old');
	});

	it('is null when every reading is soft-deleted', () => {
		expect(
			currentValuation([valuation('x', 'h', '2026-08-01', 1_00, { isDeleted: true })])
		).toBeNull();
	});
});

describe('readHolding', () => {
	const h = holding('h', { reminderDays: 30 });

	it('reports zero and stale when it has never been valued', () => {
		const reading = readHolding({ holding: h, valuations: [], today: TODAY });
		expect(reading.value).toBe(0);
		expect(reading.asOf).toBeNull();
		expect(reading.ageDays).toBeNull();
		expect(reading.isStale).toBe(true);
		expect(reading.isOverdue).toBe(true);
	});

	it('ignores another holding’s readings', () => {
		const reading = readHolding({
			holding: h,
			valuations: [valuation('other', 'elsewhere', '2026-08-24', 500_00)],
			today: TODAY
		});
		expect(reading.latest).toBeNull();
	});

	it('measures the change against the previous reading', () => {
		const reading = readHolding({
			holding: h,
			valuations: [
				valuation('a', 'h', '2026-07-25', 403_800_00),
				valuation('b', 'h', '2026-08-25', 412_000_00)
			],
			today: TODAY
		});
		expect(reading.value).toBe(412_000_00);
		expect(reading.change).toBe(8_200_00);
		expect(reading.changePercent).toBe(2);
	});

	it('keeps the sign when a holding falls — a share would not', () => {
		const reading = readHolding({
			holding: h,
			valuations: [
				valuation('a', 'h', '2026-07-25', 100_000_00),
				valuation('b', 'h', '2026-08-25', 75_000_00)
			],
			today: TODAY
		});
		expect(reading.change).toBe(-25_000_00);
		expect(reading.changePercent).toBe(-25);
	});

	describe('staleness boundaries', () => {
		const at = (date: string) =>
			readHolding({ holding: h, valuations: [valuation('v', 'h', date, 1_000_00)], today: TODAY });

		it('is fresh exactly at the cadence', () => {
			const reading = at('2026-07-26'); // 30 days
			expect(reading.ageDays).toBe(30);
			expect(reading.isStale).toBe(false);
		});

		it('is stale one day past it', () => {
			const reading = at('2026-07-25'); // 31 days
			expect(reading.isStale).toBe(true);
			expect(reading.isOverdue).toBe(false);
		});

		it('is overdue past twice the cadence', () => {
			const reading = at('2026-06-25'); // 61 days
			expect(reading.isStale).toBe(true);
			expect(reading.isOverdue).toBe(true);
		});

		it('reads today as zero days old, not as negative', () => {
			expect(at(TODAY).ageDays).toBe(0);
		});

		it('honours a holding’s own cadence rather than a global one', () => {
			const quarterly = holding('q', { reminderDays: 90 });
			const reading = readHolding({
				holding: quarterly,
				valuations: [valuation('v', 'q', '2026-07-25', 1_000_00)],
				today: TODAY
			});
			expect(reading.isStale).toBe(false);
		});
	});
});

describe('readHoldings', () => {
	it('drops archived and deleted rows and sorts by sortOrder', () => {
		const readings = readHoldings({
			holdings: [
				holding('second', { sortOrder: 1 }),
				holding('gone', { sortOrder: 2, isDeleted: true }),
				holding('hidden', { sortOrder: 3, isArchived: true }),
				holding('first', { sortOrder: 0 })
			],
			valuations: [],
			today: TODAY
		});
		expect(readings.map((r) => r.holding.id)).toEqual(['first', 'second']);
	});
});

describe('wealthTotal', () => {
	const fresh = (id: string, value: number) =>
		readHolding({
			holding: holding(id),
			valuations: [valuation(`v-${id}`, id, TODAY, value)],
			today: TODAY
		});

	it('adds cash to holdings', () => {
		const wealth = wealthTotal({ cash: minor(44_324_50), readings: [fresh('a', 412_000_00)] });
		expect(wealth.cash).toBe(44_324_50);
		expect(wealth.invested).toBe(412_000_00);
		expect(wealth.total).toBe(456_324_50);
	});

	it('handles cash only, holdings only, and an overdrawn account', () => {
		expect(wealthTotal({ cash: minor(1_000_00), readings: [] }).total).toBe(1_000_00);
		expect(wealthTotal({ cash: 0 as Minor, readings: [fresh('a', 500_00)] }).total).toBe(500_00);
		expect(wealthTotal({ cash: minor(-2_000_00), readings: [fresh('a', 500_00)] }).total).toBe(
			-1_500_00
		);
	});

	it('says nothing about freshness while every reading is current', () => {
		const wealth = wealthTotal({
			cash: 0 as Minor,
			readings: [fresh('a', 1_00), fresh('b', 2_00)]
		});
		expect(wealth.restsOn).toBeNull();
		expect(wealth.staleCount).toBe(0);
	});

	it('names the oldest reading the total rests on', () => {
		const old = readHolding({
			holding: holding('old'),
			valuations: [valuation('v1', 'old', '2026-06-03', 100_00)],
			today: TODAY
		});
		const older = readHolding({
			holding: holding('older'),
			valuations: [valuation('v2', 'older', '2026-05-11', 100_00)],
			today: TODAY
		});
		const wealth = wealthTotal({ cash: 0 as Minor, readings: [old, fresh('now', 1_00), older] });
		expect(wealth.restsOn).toBe('2026-05-11');
		expect(wealth.staleCount).toBe(2);
	});

	it('counts a never-valued holding as stale but never as a date', () => {
		const never = readHolding({ holding: holding('never'), valuations: [], today: TODAY });
		const wealth = wealthTotal({ cash: 0 as Minor, readings: [never, fresh('now', 1_00)] });
		expect(wealth.staleCount).toBe(1);
		// Zero cannot be out of date, so it must not put a date on the total.
		expect(wealth.restsOn).toBeNull();
	});
});

describe('valuationWarning', () => {
	const previous = valuation('p', 'h', '2026-07-25', 400_000_00);

	it('says nothing on a first reading', () => {
		expect(valuationWarning(minor(400_000_00), null)).toBeNull();
	});

	it('says nothing about an ordinary month', () => {
		expect(valuationWarning(minor(412_000_00), previous)).toBeNull();
		expect(valuationWarning(minor(330_000_00), previous)).toBeNull();
	});

	it('catches a missing digit', () => {
		expect(valuationWarning(minor(40_000_00), previous)).toContain('míň');
	});

	it('catches an extra digit', () => {
		expect(valuationWarning(minor(4_000_000_00), previous)).toContain('víc');
	});

	it('does not divide by a zero previous reading', () => {
		expect(valuationWarning(minor(1_000_00), valuation('z', 'h', '2026-07-01', 0))).toBeNull();
	});
});

/**
 * The invariant the whole feature is arranged around (`docs/INVESTMENTS.md` §1).
 *
 * If a valuation ever reaches `income`, the 10/10/10/70 split silently becomes
 * fiction: a month where the pension moved up eight thousand would report a
 * healthy savings share out of money that was never earned or allocated.
 *
 * The structural guard is that neither function takes holdings as input. This
 * test is the one that fails if someone ever widens them to.
 */
describe('holdings never reach the month summary or the split', () => {
	const categories: Category[] = [
		{
			id: 'save',
			parentId: null,
			name: 'SPOŘENÍ',
			spendType: 'save',
			monthlyCap: null,
			sortOrder: 0,
			isArchived: false,
			isIncome: false,
			...SYNCED
		},
		{
			id: 'in',
			parentId: null,
			name: 'PŘÍJEM',
			spendType: 'save',
			monthlyCap: null,
			sortOrder: 1,
			isArchived: false,
			isIncome: true,
			...SYNCED
		}
	];

	const txn = (id: string, amount: number, categoryId: string): Txn => ({
		id,
		accountId: 'acc',
		date: '2026-08-10',
		amount: minor(amount),
		categoryId,
		payee: '',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		createdAt: '2026-08-10T10:00:00.000Z',
		isOneOff: false,
		owedAmount: null,
		owedBy: null,
		settledByTxnId: null,
		scheduleId: null,
		...SYNCED
	});

	const txns = [txn('salary', 60_000_00, 'in'), txn('contribution', -2_000_00, 'save')];
	const context = { month: '2026-08', txns, categories, today: TODAY };

	it('produces the same month summary whatever the holdings did', () => {
		const summary = summariseMonth(context);

		// A pension that gained a quarter of a million this month.
		const growth = readHolding({
			holding: holding('pension'),
			valuations: [
				valuation('a', 'pension', '2026-08-01', 400_000_00),
				valuation('b', 'pension', '2026-08-25', 650_000_00)
			],
			today: TODAY
		});
		expect(growth.change).toBe(250_000_00);

		expect(summariseMonth(context)).toEqual(summary);
		expect(summary.income).toBe(60_000_00);
		expect(summary.net).toBe(58_000_00);
	});

	it('produces the same split, and growth is nowhere in it', () => {
		const summary = summariseMonth(context);
		const split = prosperitySplit({ income: summary.income, buckets: summary.buckets });

		expect(split.income).toBe(60_000_00);
		// The 2 000 Kč contribution, not the 250 000 Kč the holding gained.
		expect(split.slices.find((s) => s.cls === 'save')?.amount).toBe(2_000_00);
		expect(split.left).toBe(58_000_00);
	});
});
