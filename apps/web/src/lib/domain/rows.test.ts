/**
 * The guard at the backup door and the sync door.
 *
 * Two things are asserted with equal weight: that a corrupt row is named, and
 * that every shape the app has ever written still passes — a guard that turns
 * a two-year-old backup away is worse than no guard.
 */

import { describe, expect, it } from 'vitest';

import { checkRow } from './rows';
import type { SyncedEntity } from './types';

const synced = {
	updatedAt: '2026-09-05T10:00:00.000Z',
	deviceId: '01a07223-8758-7065-adbf-77007c147371',
	isDeleted: false
};

/** One well-formed row per entity, as `repo.ts` writes them today. */
const ROWS: Record<SyncedEntity, Record<string, unknown>> = {
	txn: {
		id: 't1',
		accountId: 'a1',
		date: '2026-09-05',
		amount: -24900,
		categoryId: 'c1',
		payee: 'Rohlík',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		shares: [{ id: 's1', who: 'Honza', amount: 12000, settledByTxnId: null }],
		scheduleId: null,
		createdAt: '2026-09-05T10:00:00.000Z',
		...synced
	},
	account: {
		id: 'a1',
		name: 'Běžný účet',
		kind: 'checking',
		openingBalance: 0,
		openingDate: '2026-09-05',
		pockets: [{ id: 'p1', name: 'Revolut', amount: 500000 }],
		currency: 'CZK',
		isArchived: false,
		sortOrder: 0,
		...synced
	},
	category: {
		id: 'c1',
		parentId: null,
		name: 'POTRAVINY',
		spendType: 'need',
		monthlyCap: null,
		sortOrder: 0,
		isArchived: false,
		isIncome: false,
		icon: 'shopping-cart',
		color: 'teal',
		...synced
	},
	goal: {
		id: 'g1',
		name: 'Rezerva',
		why: 'Tři měsíce klidu, kdyby cokoli.',
		targetAmount: 15000000,
		targetDate: '2027-06-30',
		linkedAccountId: null,
		categoryId: null,
		startDate: '2026-09-01',
		startAmount: 0,
		isPinned: true,
		...synced
	},
	monthTarget: { id: 'm1', goalId: 'g1', month: '2026-09', amount: 500000, ...synced },
	holding: {
		id: 'h1',
		name: 'ETF',
		kind: 'investment',
		currency: 'CZK',
		categoryId: null,
		startDate: '2026-09-01',
		reminderDays: 30,
		isArchived: false,
		sortOrder: 0,
		...synced
	},
	valuation: {
		id: 'v1',
		holdingId: 'h1',
		date: '2026-09-05',
		value: 12345600,
		note: null,
		createdAt: '2026-09-05T10:00:00.000Z',
		...synced
	},
	schedule: {
		id: 's1',
		accountId: 'a1',
		payee: 'Hypotéka',
		categoryId: 'c1',
		amount: -3200000,
		dayOfMonth: 15,
		startMonth: '2026-01',
		endMonth: null,
		mode: 'confirm',
		shares: [{ id: 'ss1', who: 'Partner', amount: 1600000 }],
		lastPostedMonth: '2026-08',
		isArchived: false,
		sortOrder: 0,
		...synced
	},
	reconciliation: {
		id: 'r1',
		accountId: 'a1',
		date: '2026-08-31',
		statementBalance: 12345,
		computedBalance: 12000,
		adjustmentTxnId: null,
		...synced
	},
	dayMark: { date: '2026-08-20', deviceId: synced.deviceId, updatedAt: synced.updatedAt }
};

/** The row as an older build wrote it: the same object minus the fields it did not have yet. */
function without(row: Record<string, unknown>, ...fields: string[]): Record<string, unknown> {
	const older = { ...row };
	for (const field of fields) delete older[field];
	return older;
}

describe('checkRow — what passes', () => {
	it.each(Object.keys(ROWS) as SyncedEntity[])('accepts a well-formed %s', (entity) => {
		expect(checkRow(entity, ROWS[entity])).toBeNull();
	});

	it('ignores fields it has never heard of — a newer build is still this app', () => {
		expect(checkRow('txn', { ...ROWS.txn, mood: 'ok', tags: ['x'] })).toBeNull();
	});

	it('accepts the legacy owed trio on a row with no shares array', () => {
		const legacy = without(ROWS.txn, 'shares');
		expect(
			checkRow('txn', { ...legacy, owedAmount: 12000, owedBy: 'Honza', settledByTxnId: null })
		).toBeNull();
	});

	it('accepts the shapes older schema versions wrote', () => {
		expect(checkRow('account', without(ROWS.account, 'pockets'))).toBeNull();
		expect(checkRow('category', without(ROWS.category, 'icon', 'color'))).toBeNull();
		expect(checkRow('schedule', without(ROWS.schedule, 'accountId', 'shares'))).toBeNull();
		expect(checkRow('txn', without(ROWS.txn, 'scheduleId', 'shares', 'isOneOff'))).toBeNull();
		expect(checkRow('goal', without(ROWS.goal, 'startAmount', 'isPinned', 'startDate'))).toBeNull();
	});

	it('does not police enum membership — that is evolution, not corruption', () => {
		expect(checkRow('category', { ...ROWS.category, spendType: 'invest' })).toBeNull();
		expect(checkRow('holding', { ...ROWS.holding, kind: 'property' })).toBeNull();
	});
});

describe('checkRow — what it turns away', () => {
	it('refuses anything that is not an object', () => {
		expect(checkRow('txn', null)).toMatch(/not an object/);
		expect(checkRow('txn', [1, 2])).toMatch(/not an object/);
		expect(checkRow('txn', 'row')).toMatch(/not an object/);
		expect(checkRow('txn', undefined)).toMatch(/not an object/);
	});

	it('refuses an entity it does not know', () => {
		expect(checkRow('evil' as SyncedEntity, ROWS.txn)).toMatch(/unknown entity/);
	});

	/** The two rows that blanked every screen in the audit. */
	it('names the amount when it is not a whole number of haléře', () => {
		expect(checkRow('txn', { ...ROWS.txn, amount: -1000.5 })).toBe(
			'amount: not a whole number of minor units'
		);
		expect(checkRow('txn', { ...ROWS.txn, amount: 'abc' })).toMatch(/^amount:/);
		expect(checkRow('txn', { ...ROWS.txn, amount: Number.NaN })).toMatch(/^amount:/);
		expect(checkRow('txn', { ...ROWS.txn, amount: 2 ** 53 })).toMatch(/^amount:/);
	});

	it('checks every amount, not only the transaction’s', () => {
		expect(checkRow('account', { ...ROWS.account, openingBalance: 1.5 })).toMatch(
			/^openingBalance:/
		);
		expect(checkRow('goal', { ...ROWS.goal, targetAmount: '100' })).toMatch(/^targetAmount:/);
		expect(checkRow('monthTarget', { ...ROWS.monthTarget, amount: null })).toMatch(/^amount:/);
		expect(checkRow('valuation', { ...ROWS.valuation, value: 0.1 })).toMatch(/^value:/);
		expect(checkRow('schedule', { ...ROWS.schedule, amount: -32000.5 })).toMatch(/^amount:/);
		expect(
			checkRow('reconciliation', {
				...ROWS.reconciliation,
				computedBalance: Number.POSITIVE_INFINITY
			})
		).toMatch(/^computedBalance:/);
		expect(checkRow('category', { ...ROWS.category, monthlyCap: 12.5 })).toMatch(/^monthlyCap:/);
	});

	it('walks into the arrays the accessors walk', () => {
		expect(checkRow('txn', { ...ROWS.txn, shares: [{ id: 's', who: 'x', amount: 0.5 }] })).toBe(
			'shares: [0].amount: not a whole number of minor units'
		);
		expect(checkRow('txn', { ...ROWS.txn, shares: 'none' })).toBe('shares: not a list');
		expect(
			checkRow('account', { ...ROWS.account, pockets: [{ id: 'p', name: 'x', amount: '5' }] })
		).toMatch(/^pockets: \[0\]\.amount/);
		expect(checkRow('txn', { ...ROWS.txn, owedAmount: 1.5 })).toMatch(/^owedAmount:/);
	});

	it('refuses a row the merge could not place', () => {
		expect(checkRow('txn', { ...ROWS.txn, id: '' })).toMatch(/^id:/);
		expect(checkRow('txn', { ...ROWS.txn, id: 42 })).toMatch(/^id:/);
		expect(checkRow('txn', { ...ROWS.txn, updatedAt: undefined })).toMatch(/^updatedAt:/);
		expect(checkRow('txn', { ...ROWS.txn, deviceId: null })).toMatch(/^deviceId:/);
		expect(checkRow('txn', { ...ROWS.txn, isDeleted: 'no' })).toMatch(/^isDeleted:/);
	});

	it('refuses a date that is not one', () => {
		expect(checkRow('txn', { ...ROWS.txn, date: '2026-13-45' })).toBe('date: not a calendar date');
		expect(checkRow('txn', { ...ROWS.txn, date: '2026-02-30' })).toBe('date: not a calendar date');
		expect(checkRow('txn', { ...ROWS.txn, date: '5. 9. 2026' })).toMatch(/^date:/);
		expect(checkRow('txn', { ...ROWS.txn, date: 20260905 })).toMatch(/^date:/);
		expect(checkRow('goal', { ...ROWS.goal, targetDate: '' })).toMatch(/^targetDate:/);
		expect(checkRow('dayMark', { ...ROWS.dayMark, date: 'today' })).toMatch(/^date:/);
	});

	it('refuses a month or a day that is not one', () => {
		expect(checkRow('monthTarget', { ...ROWS.monthTarget, month: '2026-13' })).toMatch(/^month:/);
		expect(checkRow('schedule', { ...ROWS.schedule, startMonth: '2026' })).toMatch(/^startMonth:/);
		expect(checkRow('schedule', { ...ROWS.schedule, dayOfMonth: 0 })).toMatch(/^dayOfMonth:/);
		expect(checkRow('schedule', { ...ROWS.schedule, dayOfMonth: 32 })).toMatch(/^dayOfMonth:/);
		expect(checkRow('schedule', { ...ROWS.schedule, dayOfMonth: 15.5 })).toMatch(/^dayOfMonth:/);
	});

	it('refuses the wrong type where a screen branches or reads text', () => {
		expect(checkRow('txn', { ...ROWS.txn, payee: null })).toMatch(/^payee:/);
		expect(checkRow('txn', { ...ROWS.txn, categoryId: 7 })).toMatch(/^categoryId:/);
		expect(checkRow('category', { ...ROWS.category, name: ['x'] })).toMatch(/^name:/);
		expect(checkRow('category', { ...ROWS.category, isIncome: 1 })).toMatch(/^isIncome:/);
		expect(checkRow('account', { ...ROWS.account, currency: '' })).toMatch(/^currency:/);
		expect(checkRow('holding', { ...ROWS.holding, reminderDays: '30' })).toMatch(/^reminderDays:/);
	});
});
