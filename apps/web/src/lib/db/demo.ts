/**
 * The demo's two verbs — DECISIONS Q74.
 *
 * `seedDemo` writes the sample ledger (`domain/demo.ts`) through `repo.ts`,
 * so every row is stamped, shaped and guarded exactly like one typed by hand.
 * It runs from the layout, once, right after `ensureSeeded` has made the
 * account and the buckets and before the schedule catch-up — which is what
 * lets the declared rent and Netflix show up on Domů as dues.
 *
 * `resetDemo` is the demo's Začít znovu: it empties every table in one
 * transaction and reloads, and the launch path seeds again. That is a
 * deliberate exception to soft delete (rule 2), safe because a demo holds no
 * one's ledger and has no second device to reconcile with.
 */

import { resolve } from '$app/paths';
import { demoLedger } from '$lib/domain/demo';
import { today } from '$lib/domain/datetime';
import {
	createGoal,
	createHolding,
	createSchedule,
	createTxn,
	recordValuation,
	updateAccount
} from './repo';
import { db } from './schema';

export async function seedDemo(accountId: string): Promise<void> {
	const ledger = demoLedger(today());
	const buckets = new Map(
		(await db().categories.toArray()).filter((c) => !c.isDeleted).map((c) => [c.name, c.id])
	);
	const bucket = (name: string): string => {
		const id = buckets.get(name);
		if (!id) throw new Error(`demo: the seed has no bucket named ${name}`);
		return id;
	};

	await updateAccount(accountId, {
		openingBalance: ledger.openingBalance,
		openingDate: ledger.openingDate
	});

	for (const row of ledger.txns) {
		await createTxn({
			accountId,
			date: row.date,
			amount: row.amount,
			categoryId: bucket(row.category),
			payee: row.payee,
			isOneOff: row.isOneOff ?? false,
			isProvisional: row.isProvisional ?? false,
			shares: row.shares ?? []
		});
	}

	for (const schedule of ledger.schedules) {
		await createSchedule({
			accountId,
			payee: schedule.payee,
			categoryId: bucket(schedule.category),
			amount: schedule.amount,
			dayOfMonth: schedule.dayOfMonth,
			mode: schedule.mode
		});
	}

	await createGoal({
		name: ledger.goal.name,
		why: ledger.goal.why,
		targetAmount: ledger.goal.targetAmount,
		targetDate: ledger.goal.targetDate,
		startAmount: ledger.goal.startAmount,
		categoryId: bucket(ledger.goal.category)
	});

	const holding = await createHolding({
		name: ledger.holding.name,
		kind: ledger.holding.kind,
		startDate: ledger.holding.valuations[0]?.date
	});
	for (const reading of ledger.holding.valuations) {
		await recordValuation({ holdingId: holding.id, value: reading.value, date: reading.date });
	}
}

/**
 * Every table cleared — rows, meta, outbox, the lot — and not the database
 * dropped: a delete needs every connection closed, Dexie re-opens one for any
 * live query the moment it is closed, and the delete sits blocked for ever.
 * Clearing needs no version change and works with the screens still
 * listening. The reload then runs the launch path, which finds nothing and
 * seeds the sample again.
 */
export async function resetDemo(): Promise<void> {
	const database = db();
	await database.transaction('rw', database.tables, async () => {
		await Promise.all(database.tables.map((table) => table.clear()));
	});
	location.assign(resolve('/'));
}
