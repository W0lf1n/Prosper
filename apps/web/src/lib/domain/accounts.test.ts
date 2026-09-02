import { describe, expect, it } from 'vitest';
import {
	EXCHANGE_CATEGORY_ID,
	availableCurrencies,
	groupByCurrency,
	homeCurrency,
	inCurrency,
	isTransfer,
	lastExchangeCategoryId,
	liveAccounts,
	openingTotal,
	pocketsOf,
	validatePocket,
	validateTransfer
} from './accounts';
import { minor } from './money';
import type { Account, Txn } from './types';

const SYNCED = { updatedAt: '2026-08-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };

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

function txn(id: string, accountId: string, extra: Partial<Txn> = {}): Txn {
	return {
		id,
		accountId,
		date: '2026-08-20',
		amount: minor(-100_00),
		categoryId: 'cat',
		payee: 'oběd',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		shares: [],
		scheduleId: null,
		createdAt: '2026-08-20T10:00:00.000Z',
		...SYNCED,
		...extra
	};
}

describe('the home currency', () => {
	it('is the first live account’s', () => {
		const accounts = [
			account('kb', { sortOrder: 0 }),
			account('revolut', { currency: 'EUR', sortOrder: 1 })
		];
		expect(homeCurrency(accounts)).toBe('CZK');
	});

	it('skips archived and deleted accounts', () => {
		const accounts = [
			account('old', { currency: 'EUR', sortOrder: 0, isArchived: true }),
			account('kb', { sortOrder: 1 })
		];
		expect(homeCurrency(accounts)).toBe('CZK');
	});

	it('is CZK when nothing exists yet', () => {
		expect(homeCurrency([])).toBe('CZK');
	});
});

describe('inCurrency — the only way rows may be summed together', () => {
	const accounts = [account('kb'), account('revolut', { currency: 'EUR', sortOrder: 1 })];

	it('keeps only rows of accounts held in the currency', () => {
		const rows = [txn('a', 'kb'), txn('b', 'revolut'), txn('c', 'kb')];
		expect(inCurrency(rows, accounts, 'CZK').map((t) => t.id)).toEqual(['a', 'c']);
		expect(inCurrency(rows, accounts, 'EUR').map((t) => t.id)).toEqual(['b']);
	});

	it('still counts an archived account — its history is real', () => {
		const withArchived = [account('kb', { isArchived: true }), accounts[1]!];
		expect(inCurrency([txn('a', 'kb')], withArchived, 'CZK')).toHaveLength(1);
	});
});

describe('grouping by currency', () => {
	it('buckets live accounts in first-appearance order', () => {
		const groups = groupByCurrency([
			account('kb', { sortOrder: 0 }),
			account('revolut', { currency: 'EUR', sortOrder: 1 }),
			account('cash', { kind: 'cash', sortOrder: 2 })
		]);
		expect([...groups.keys()]).toEqual(['CZK', 'EUR']);
		expect(groups.get('CZK')!.map((a) => a.id)).toEqual(['kb', 'cash']);
	});

	it('ignores archived accounts', () => {
		const groups = groupByCurrency([
			account('kb'),
			account('revolut', { currency: 'EUR', isArchived: true, sortOrder: 1 })
		]);
		expect([...groups.keys()]).toEqual(['CZK']);
	});

	it('orders by sortOrder, not by array order', () => {
		expect(
			liveAccounts([account('b', { sortOrder: 1 }), account('a', { sortOrder: 0 })]).map(
				(a) => a.id
			)
		).toEqual(['a', 'b']);
	});
});

describe('validateTransfer', () => {
	const kb = account('kb');
	const revolut = account('revolut', { currency: 'EUR', sortOrder: 1 });
	const holiday = 'cat-dovolena';

	it('accepts two accounts, two positive amounts and a bucket', () => {
		expect(
			validateTransfer({
				from: kb,
				to: revolut,
				amountOut: 2470_00,
				amountIn: 100_00,
				categoryId: holiday
			})
		).toEqual([]);
	});

	it('refuses a transfer onto itself and non-amounts', () => {
		expect(
			validateTransfer({ from: kb, to: kb, amountOut: 100, amountIn: 100, categoryId: holiday })
		).toContain('same-account');
		expect(
			validateTransfer({ from: kb, to: revolut, amountOut: 0, amountIn: 100, categoryId: holiday })
		).toContain('amount-out');
		expect(
			validateTransfer({ from: kb, to: revolut, amountOut: 100, amountIn: -5, categoryId: holiday })
		).toContain('amount-in');
	});

	it('refuses an exchange without a bucket — the outgoing leg is an expense', () => {
		expect(
			validateTransfer({ from: kb, to: revolut, amountOut: 100, amountIn: 4, categoryId: null })
		).toEqual(['category']);
		expect(
			validateTransfer({ from: kb, to: revolut, amountOut: 100, amountIn: 4, categoryId: '' })
		).toEqual(['category']);
	});
});

describe('isTransfer', () => {
	it('reads off the pair link', () => {
		expect(isTransfer(txn('a', 'kb'))).toBe(false);
		expect(isTransfer(txn('b', 'kb', { transferPairId: 'a' }))).toBe(true);
	});
});

describe('lastExchangeCategoryId() — the sheet opens on the last bucket used', () => {
	it('is the bucket of the most recent outgoing leg', () => {
		const rows = [
			txn('out-1', 'kb', {
				transferPairId: 'in-1',
				categoryId: 'cat-lifestyle',
				createdAt: '2026-07-01T10:00:00.000Z'
			}),
			txn('in-1', 'revolut', {
				transferPairId: 'out-1',
				amount: minor(100_00),
				categoryId: EXCHANGE_CATEGORY_ID,
				createdAt: '2026-07-01T10:00:00.000Z'
			}),
			txn('out-2', 'kb', {
				transferPairId: 'in-2',
				categoryId: 'cat-dovolena',
				createdAt: '2026-08-20T10:00:00.000Z'
			}),
			// An ordinary expense, newer than both — not an exchange, so not the answer.
			txn('lunch', 'kb', { categoryId: 'cat-jidlo', createdAt: '2026-08-21T10:00:00.000Z' })
		];
		expect(lastExchangeCategoryId(rows)).toBe('cat-dovolena');
	});

	it('ignores deleted legs, incoming legs and legs written before buckets existed', () => {
		const rows = [
			txn('gone', 'kb', {
				transferPairId: 'x',
				categoryId: 'cat-old',
				isDeleted: true,
				createdAt: '2026-08-30T00:00:00.000Z'
			}),
			txn('in', 'revolut', {
				transferPairId: 'y',
				amount: minor(50_00),
				categoryId: EXCHANGE_CATEGORY_ID
			}),
			txn('legacy', 'kb', { transferPairId: 'z', categoryId: null })
		];
		expect(lastExchangeCategoryId(rows)).toBeNull();
		expect(lastExchangeCategoryId([])).toBeNull();
	});
});

describe('availableCurrencies() — one account per currency (Q50)', () => {
	it('offers only the currencies no live account holds', () => {
		const accounts = [account('kb', { currency: 'CZK' }), account('rev', { currency: 'EUR' })];
		expect(availableCurrencies(accounts)).toEqual(['USD', 'GBP']);
	});

	it('frees a currency when its account is archived or deleted', () => {
		const accounts = [
			account('kb', { currency: 'CZK' }),
			account('old', { currency: 'EUR', isArchived: true }),
			account('gone', { currency: 'USD', isDeleted: true })
		];
		expect(availableCurrencies(accounts)).toEqual(['EUR', 'USD', 'GBP']);
	});

	it('offers everything to an empty ledger', () => {
		expect(availableCurrencies([])).toEqual(['CZK', 'EUR', 'USD', 'GBP']);
	});
});

describe('pockets — koruny held elsewhere (Q50)', () => {
	it('reads an older row without the field as having none', () => {
		const legacy = account('kb');
		delete (legacy as Partial<Account>).pockets;
		expect(pocketsOf(legacy)).toEqual([]);
		expect(openingTotal(legacy)).toBe(minor(0));
	});

	it('opens the account with the stated balance plus every pocket', () => {
		const kb = account('kb', {
			openingBalance: minor(20_000),
			pockets: [
				{ id: 'p1', name: 'Revolut', amount: minor(5_000) },
				{ id: 'p2', name: 'hotovost', amount: minor(1_200) }
			]
		});
		expect(openingTotal(kb)).toBe(minor(26_200));
	});

	it('refuses a pocket without a name or without money in it', () => {
		expect(validatePocket({ name: '  ', amount: minor(100) })).toEqual(['name']);
		expect(validatePocket({ name: 'Revolut', amount: minor(0) })).toEqual(['amount']);
		expect(validatePocket({ name: 'Revolut', amount: -1 })).toEqual(['amount']);
		expect(validatePocket({ name: 'Revolut', amount: minor(5_000) })).toEqual([]);
	});
});
