/**
 * Pairing — `POST /api/v1/pair`.
 *
 * A device swaps a code for a token, and the token is device-bound. There is no
 * account, no password and no e-mail: one person, their own devices, and a
 * code that is typed once.
 *
 * Pairing is the moment the outbox starts mattering, so it does two things in
 * one order that cannot be swapped: it stores the settings first, which makes
 * `enqueue` live, and then backfills every existing row. Reversed, every write
 * made during the backfill would be dropped.
 */

import type { PairRequest, PairResponse } from '@vydaje/contracts';
import { adoptRemoteLedger, seedOutbox } from '$lib/db/repo';
import { pullOnce, readSettings } from './engine';
import { configure } from './status.svelte';

export interface PairInput {
	baseUrl: string;
	code: string;
	deviceName: string;
}

export async function pair({ baseUrl, code, deviceName }: PairInput): Promise<void> {
	const trimmed = baseUrl.replace(/\/+$/, '');

	const response = await fetch(`${trimmed}/api/v1/pair`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code, deviceName } satisfies PairRequest)
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(
			response.status === 401 || response.status === 403
				? 'Kód nesedí.'
				: body || `Server odpověděl ${response.status}.`
		);
	}

	const { token } = (await response.json()) as PairResponse;
	if (!token) throw new Error('Server nevrátil token.');

	// The order of these three is the whole of pairing, and none of them move.
	//
	//   1. Store the settings, which is what makes `enqueue` live. Any write
	//      from here on is queued rather than lost.
	//   2. Pull before pushing anything. A device joining an existing ledger has
	//      to see it before it can decide whether its own seed is redundant —
	//      and `adoptRemoteLedger` cannot make that call against a database that
	//      has not heard of the other device yet.
	//   3. Only then backfill, so what goes up is this device's real rows plus
	//      the tombstones for the seed it just gave up.
	await configure({ baseUrl: trimmed, token });

	const settings = await readSettings();
	if (settings) await pullOnce(settings);

	await adoptRemoteLedger();
	await seedOutbox();
}

export async function unpair(): Promise<void> {
	await configure(null);
}
