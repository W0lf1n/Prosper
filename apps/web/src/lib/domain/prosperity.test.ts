import { describe, expect, it } from 'vitest';
import { classOf, prosperitySplit, targetSlices, verdict } from './prosperity';
import { minor } from './money';
import type { BucketTotal } from './checks';
import type { Category, SpendType } from './types';

function category(name: string, spendType: SpendType): Category {
	return {
		id: `cat-${name}`,
		parentId: null,
		name,
		spendType,
		monthlyCap: null,
		sortOrder: 0,
		isArchived: false,
		isIncome: false,
		icon: 'tag',
		color: 'stone',
		updatedAt: '2026-08-01T00:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false
	};
}

/** Spending is negative in a bucket total, exactly as `summariseMonth` emits it. */
function bucket(name: string | null, spendType: SpendType, total: number): BucketTotal {
	return {
		category: name ? category(name, spendType) : null,
		total: minor(total),
		oneOffTotal: minor(0),
		count: 1,
		share: 0,
		recurringShare: 0
	};
}

describe('which class a bucket falls in', () => {
	it('keeps the three deliberate ones apart', () => {
		expect(classOf('give')).toBe('give');
		expect(classOf('save')).toBe('save');
		expect(classOf('debt')).toBe('debt');
	});

	// They stay separate everywhere else — the need/want line is what Trimming
	// acts on — but the book's 70 % is one number.
	it('folds need and want together into living', () => {
		expect(classOf('need')).toBe('live');
		expect(classOf('want')).toBe('live');
	});
});

describe('the split', () => {
	const income = minor(50_000_00);
	const onTarget = [
		bucket('DARY', 'give', -5_000_00),
		bucket('SPOŘENÍ', 'save', -5_000_00),
		bucket('DLUH', 'debt', -5_000_00),
		bucket('BYDLENÍ', 'need', -25_000_00),
		bucket('JÍDLO', 'want', -10_000_00)
	];

	it('reports each class as a share of income, not of outflow', () => {
		const split = prosperitySplit({ income, buckets: onTarget });
		expect(split.slices.map((s) => [s.cls, s.percent])).toEqual([
			['give', 10],
			['save', 10],
			['debt', 10],
			['live', 70]
		]);
		expect(split.left).toBe(0);
		expect(split.weakest).toBeNull();
	});

	it('adds need and want into one living figure', () => {
		const split = prosperitySplit({ income, buckets: onTarget });
		expect(split.slices.find((s) => s.cls === 'live')?.amount).toBe(35_000_00);
	});

	// A share of outflow always sums to 100 % and can never say this.
	it('shows what is left over, and a deficit as a negative', () => {
		const under = prosperitySplit({
			income,
			buckets: [bucket('BYDLENÍ', 'need', -30_000_00)]
		});
		expect(under.left).toBe(20_000_00);
		expect(under.leftPercent).toBe(40);

		const over = prosperitySplit({
			income,
			buckets: [bucket('BYDLENÍ', 'need', -60_000_00)]
		});
		expect(over.left).toBe(-10_000_00);
		expect(over.leftPercent).toBe(-20);
		expect(verdict(over)).toBe('Utraceno o 20 % víc, než přišlo.');
	});

	it('names the one class furthest below its mark', () => {
		const split = prosperitySplit({
			income,
			buckets: [
				bucket('SPOŘENÍ', 'save', -4_000_00), // 8 %, −2
				bucket('DARY', 'give', -500_00), // 1 %, −9
				bucket('DLUH', 'debt', -5_000_00), // 10 %, on the mark
				bucket('BYDLENÍ', 'need', -35_000_00)
			]
		});
		expect(split.weakest?.cls).toBe('give');
		expect(verdict(split)).toBe('Dávání: 1 % místo 10 %. Tohle je ta jedna věc.');
	});

	// A class with nothing in it is the biggest shortfall there is, and saying so
	// is the whole point — the bucket you never fund is invisible everywhere else.
	it('treats a class that got nothing as the worst of them', () => {
		const split = prosperitySplit({
			income,
			buckets: [
				bucket('DARY', 'give', -4_000_00), // 8 %, −2
				bucket('SPOŘENÍ', 'save', -4_500_00), // 9 %, −1
				bucket('BYDLENÍ', 'need', -35_000_00) // debt: nothing at all, −10
			]
		});
		expect(split.weakest?.cls).toBe('debt');
		expect(split.weakest?.percent).toBe(0);
	});

	// Being under 70 % on living is the point, not a failure.
	it('never calls living a shortfall', () => {
		const split = prosperitySplit({
			income,
			buckets: [
				bucket('DARY', 'give', -5_000_00),
				bucket('SPOŘENÍ', 'save', -5_000_00),
				bucket('DLUH', 'debt', -5_000_00),
				bucket('BYDLENÍ', 'need', -5_000_00) // 10 %, far under 70
			]
		});
		expect(split.weakest).toBeNull();
		expect(verdict(split)).toBe('Všechny tři podíly sedí. Zbytek je na život.');
	});

	it('counts an uncategorised row as part of what living cost', () => {
		const split = prosperitySplit({ income, buckets: [bucket(null, 'need', -5_000_00)] });
		expect(split.slices.find((s) => s.cls === 'live')?.amount).toBe(5_000_00);
	});

	it('refuses to divide by an income of zero', () => {
		const split = prosperitySplit({
			income: minor(0),
			buckets: [bucket('BYDLENÍ', 'need', -2_000_00)]
		});
		expect(split.hasIncome).toBe(false);
		expect(split.slices.every((s) => s.percent === 0)).toBe(true);
		expect(split.leftPercent).toBe(0);
		expect(split.weakest).toBeNull();
		expect(verdict(split)).toBe('Bez příjmu v tomhle měsíci se podíly nedají spočítat.');
	});

	it('still records the amounts when there is no income to compare them to', () => {
		const split = prosperitySplit({
			income: minor(0),
			buckets: [bucket('SPOŘENÍ', 'save', -2_000_00)]
		});
		expect(split.slices.find((s) => s.cls === 'save')?.amount).toBe(2_000_00);
	});
});

describe('the target', () => {
	it('is the book: 10 / 10 / 10 / 70', () => {
		expect(targetSlices().map((s) => s.percent)).toEqual([10, 10, 10, 70]);
		expect(targetSlices().reduce((total, s) => total + s.percent, 0)).toBe(100);
	});
});
