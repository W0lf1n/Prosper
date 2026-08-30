import { describe, expect, it } from 'vitest';
import {
	groupByCurrency,
	homeCurrency,
	inCurrency,
	isTransfer,
	liveAccounts,
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

	it('accepts two accounts and two positive amounts', () => {
		expect(
			validateTransfer({ from: kb, to: revolut, amountOut: 2470_00, amountIn: 100_00 })
		).toEqual([]);
	});

	it('refuses a transfer onto itself and non-amounts', () => {
		expect(validateTransfer({ from: kb, to: kb, amountOut: 100, amountIn: 100 })).toContain(
			'same-account'
		);
		expect(validateTransfer({ from: kb, to: revolut, amountOut: 0, amountIn: 100 })).toContain(
			'amount-out'
		);
		expect(validateTransfer({ from: kb, to: revolut, amountOut: 100, amountIn: -5 })).toContain(
			'amount-in'
		);
	});
});

describe('isTransfer', () => {
	it('reads off the pair link', () => {
		expect(isTransfer(txn('a', 'kb'))).toBe(false);
		expect(isTransfer(txn('b', 'kb', { transferPairId: 'a' }))).toBe(true);
	});
});
