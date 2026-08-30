import { describe, expect, it } from 'vitest';
import { checkDraft, summariseMonth, type CheckContext, type Draft } from './checks';
import { minor } from './money';
import type { Category, Txn } from './types';

let seq = 0;

function category(name: string, extra: Partial<Category> = {}): Category {
	return {
		id: `cat-${name.toLowerCase().replace(/\s/g, '-')}`,
		parentId: null,
		name,
		spendType: 'need',
		monthlyCap: null,
		sortOrder: 0,
		isArchived: false,
		isIncome: false,
		updatedAt: '2026-08-01T10:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false,
		...extra
	};
}

function txn(date: string, amount: number, extra: Partial<Txn> = {}): Txn {
	seq += 1;
	return {
		id: `txn-${seq}`,
		accountId: 'acc-1',
		date,
		amount: minor(amount),
		categoryId: null,
		payee: '',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		shares: [],
		scheduleId: null,
		createdAt: '2026-08-01T10:00:00.000Z',
		updatedAt: '2026-08-01T10:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false,
		...extra
	};
}

const CATEGORIES = [
	category('JÍDLO'),
	category('BYDLENÍ'),
	category('LIFESTYLE', { spendType: 'want' }),
	category('OSTATNÍ', { spendType: 'want' }),
	category('PŘÍJEM', { isIncome: true })
];

function context(recent: Txn[] = []): CheckContext {
	return { categories: CATEGORIES, recent };
}

function draft(over: Partial<Draft> = {}): Draft {
	return {
		amount: minor(20000),
		direction: 'out',
		categoryId: null,
		payee: '',
		date: '2026-08-23',
		isOneOff: false,
		...over
	};
}

const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

describe('misfiled category', () => {
	it('spots lunch filed under housing — the 25 286 Kč mistake', () => {
		const found = checkDraft(draft({ payee: 'oběd', categoryId: 'cat-bydlení' }), context());
		const misfiled = found.find((f) => f.rule === 'misfiled');
		expect(misfiled?.fix).toEqual({
			kind: 'set-category',
			categoryId: 'cat-jídlo',
			label: 'Dát do JÍDLO'
		});
	});

	it('suggests a bucket when none is chosen', () => {
		const found = checkDraft(draft({ payee: 'Netflix' }), context());
		expect(found.find((f) => f.rule === 'misfiled')?.title).toBe('Vypadá to na LIFESTYLE');
	});

	it('stays quiet when the chosen bucket already matches', () => {
		const found = checkDraft(draft({ payee: 'oběd', categoryId: 'cat-jídlo' }), context());
		expect(rules(found)).not.toContain('misfiled');
	});

	it('does not match a word that merely contains a keyword', () => {
		const found = checkDraft(draft({ payee: 'obědvat u babičky' }), context());
		expect(rules(found)).not.toContain('misfiled');
	});
});

describe('unclear records', () => {
	it('flags a description carrying a different number — "Netflix - 379" at 74 Kč', () => {
		const found = checkDraft(draft({ amount: minor(7400), payee: 'Netflix - 379' }), context());
		expect(rules(found)).toContain('unclear-number');
	});

	it('says nothing when the number in the text is the amount', () => {
		const found = checkDraft(draft({ amount: minor(37900), payee: 'Netflix 379' }), context());
		expect(rules(found)).not.toContain('unclear-number');
	});

	it('flags a vague description on a large amount — "opak. obj" at 17 074 Kč', () => {
		const found = checkDraft(draft({ amount: minor(1707400), payee: 'opak. obj' }), context());
		expect(rules(found)).toContain('vague');
	});

	it('leaves small vague entries alone — a 40 Kč "svačina" needs no essay', () => {
		const found = checkDraft(draft({ amount: minor(4000), payee: 'obj' }), context());
		expect(rules(found)).not.toContain('vague');
	});
});

describe('one-off spending', () => {
	it('offers to mark a large expense — the 41 890 Kč front door', () => {
		const found = checkDraft(draft({ amount: minor(4189000), payee: 'vchodové dveře' }), context());
		expect(found.find((f) => f.rule === 'one-off')?.fix).toEqual({
			kind: 'mark-one-off',
			label: 'Označit jako jednorázový'
		});
	});

	it('stops asking once it is marked', () => {
		const found = checkDraft(
			draft({ amount: minor(4189000), payee: 'vchodové dveře', isOneOff: true }),
			context()
		);
		expect(rules(found)).not.toContain('one-off');
	});
});

describe('refund recorded as income', () => {
	it('catches "Zůza - bydlení plyn" landing in income', () => {
		const found = checkDraft(
			draft({ direction: 'in', amount: minor(125000), payee: 'Zůza - bydlení plyn' }),
			context()
		);
		expect(found.find((f) => f.rule === 'refund-as-income')?.fix).toEqual({
			kind: 'set-category',
			categoryId: 'cat-bydlení',
			label: 'Dát do BYDLENÍ'
		});
	});

	it('leaves an actual salary alone', () => {
		const found = checkDraft(
			draft({ direction: 'in', amount: minor(4200000), payee: 'D3S výplata' }),
			context()
		);
		expect(rules(found)).not.toContain('refund-as-income');
	});
});

describe('duplicates', () => {
	it('catches the same subscription typed twice', () => {
		const existing = txn('2026-08-22', -17000, { payee: 'HBO Max' });
		const found = checkDraft(
			draft({ amount: minor(17000), payee: 'HBO Max' }),
			context([existing])
		);
		expect(found.find((f) => f.rule === 'duplicate')?.detail).toContain('včera');
	});

	it('does not flag the same shop on a different amount', () => {
		const existing = txn('2026-08-22', -17000, { payee: 'HBO Max' });
		const found = checkDraft(
			draft({ amount: minor(18000), payee: 'HBO Max' }),
			context([existing])
		);
		expect(rules(found)).not.toContain('duplicate');
	});

	it('ignores a repeat more than three days apart', () => {
		const existing = txn('2026-08-01', -17000, { payee: 'HBO Max' });
		const found = checkDraft(
			draft({ amount: minor(17000), payee: 'HBO Max' }),
			context([existing])
		);
		expect(rules(found)).not.toContain('duplicate');
	});
});

describe('summariseMonth()', () => {
	const base = {
		categories: CATEGORIES,
		today: '2026-08-31' as const
	};

	it('separates one-offs from what a month actually costs', () => {
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [
				txn('2026-08-01', 6000000, { categoryId: 'cat-příjem' }),
				txn('2026-08-02', -450000, { categoryId: 'cat-bydlení' }),
				txn('2026-08-03', -4189000, { categoryId: 'cat-bydlení', isOneOff: true })
			]
		});

		expect(summary.income).toBe(6000000);
		expect(summary.outflow).toBe(-4639000);
		expect(summary.oneOffOutflow).toBe(-4189000);
		expect(summary.recurringOutflow).toBe(-450000);
	});

	it('measures OSTATNÍ against recurring spending, not against a one-off', () => {
		// Without this, a single 41 890 Kč front door makes the dumping ground
		// look like 11 % and the check goes quiet exactly when it matters.
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [
				txn('2026-08-01', -100000, { categoryId: 'cat-jídlo' }),
				txn('2026-08-02', -100000, { categoryId: 'cat-ostatní' }),
				txn('2026-08-03', -4189000, { categoryId: 'cat-bydlení', isOneOff: true })
			]
		});

		const other = summary.buckets.find((b) => b.category?.name === 'OSTATNÍ')!;
		expect(other.share).toBe(2); // of everything
		expect(other.recurringShare).toBe(50); // of what the month actually costs
		expect(rules(summary.findings)).toContain('other-overflow');
	});

	it('flags OSTATNÍ once it takes more than a sixth of the outflow', () => {
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [
				txn('2026-08-01', -100000, { categoryId: 'cat-jídlo' }),
				txn('2026-08-02', -100000, { categoryId: 'cat-ostatní' })
			]
		});
		expect(rules(summary.findings)).toContain('other-overflow');
	});

	it('nets a refund against its bucket instead of calling it income', () => {
		// You paid 2 500 for gas and Zůza gave back 1 250. The month earned
		// nothing and gas cost 1 250 — not "1 250 earned, 2 500 spent".
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [
				txn('2026-08-01', -250000, { categoryId: 'cat-bydlení', payee: 'plyn' }),
				txn('2026-08-20', 125000, { categoryId: 'cat-bydlení', payee: 'vrácení — Zůza' })
			]
		});

		expect(summary.income).toBe(0);
		expect(summary.outflow).toBe(-125000);
		expect(summary.net).toBe(-125000);
		expect(summary.buckets.find((b) => b.category?.name === 'BYDLENÍ')?.total).toBe(-125000);
	});

	it('still counts a real salary as income', () => {
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [txn('2026-08-01', 5941400, { categoryId: 'cat-příjem', payee: 'D3S' })]
		});
		expect(summary.income).toBe(5941400);
		expect(summary.outflow).toBe(0);
	});

	it('flags a month that spent more than it earned', () => {
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [
				txn('2026-08-01', 5000000, { categoryId: 'cat-příjem' }),
				txn('2026-08-02', -6631700, { categoryId: 'cat-bydlení' })
			]
		});
		expect(rules(summary.findings)).toContain('overspend');
	});

	it('counts uncategorised outflows', () => {
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [txn('2026-08-02', -20000)]
		});
		expect(summary.findings.find((f) => f.rule === 'uncategorised')?.title).toBe(
			'1 záznam bez kategorie'
		);
	});

	it('notices a subscription that stopped appearing', () => {
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [
				txn('2026-05-10', -6000, { payee: 'Spotify', categoryId: 'cat-lifestyle' }),
				txn('2026-06-10', -6000, { payee: 'Spotify', categoryId: 'cat-lifestyle' }),
				txn('2026-07-10', -6000, { payee: 'Spotify', categoryId: 'cat-lifestyle' }),
				txn('2026-08-10', -20000, { payee: 'oběd', categoryId: 'cat-jídlo' })
			]
		});
		expect(summary.findings.find((f) => f.rule === 'missing-recurring')?.title).toBe(
			'„Spotify“ tenhle měsíc chybí'
		);
	});

	it('ranks buckets by how much they took', () => {
		const summary = summariseMonth({
			...base,
			month: '2026-08',
			txns: [
				txn('2026-08-01', -50000, { categoryId: 'cat-jídlo' }),
				txn('2026-08-02', -400000, { categoryId: 'cat-bydlení' })
			]
		});
		expect(summary.buckets.map((b) => b.category?.name)).toEqual(['BYDLENÍ', 'JÍDLO']);
		expect(summary.buckets[0]!.share).toBe(89);
	});
});
