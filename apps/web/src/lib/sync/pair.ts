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
 *
 * Before any of that it asks `/api/v1/health` whether there is a Prosper server
 * at the address at all. That request is not part of the protocol — it exists
 * because the address is typed on a phone keyboard, once, and every way of
 * getting it wrong otherwise arrives as a status code.
 */

import type { HealthResponse, PairRequest, PairResponse } from '@prosper/contracts';
import { adoptRemoteLedger, seedOutbox } from '$lib/db/repo';
import { pullOnce, readSettings } from './engine';
import { configure } from './status.svelte';

/**
 * Somebody is watching this one happen, so it is short. A server that has not
 * answered in eight seconds is not going to.
 */
const PROBE_TIMEOUT_MS = 8_000;

export interface PairInput {
	baseUrl: string;
	code: string;
	deviceName: string;
}

/**
 * The address the app is being served from.
 *
 * In the deployment this repository describes, the client and the API are one
 * origin behind one nginx — so this is the answer every time, and typing a
 * domain on a phone keyboard is the step most likely to go wrong. It is a
 * default rather than a constant: somebody serving the PWA from somewhere else
 * edits the field.
 */
export function defaultBaseUrl(): string {
	if (typeof location === 'undefined') return '';
	return location.origin.startsWith('http') ? location.origin : '';
}

/**
 * Ask the address whether a Prosper server lives there, before sending it a
 * pairing code.
 *
 * Without this, a mistyped domain answers `404` from whatever else is on that
 * host and the screen says "Server odpověděl 404" — which reads as "the sync
 * server is broken" rather than "that is not the sync server". One request buys
 * the difference between those two sentences.
 */
export async function probe(baseUrl: string): Promise<HealthResponse> {
	const trimmed = baseUrl.replace(/\/+$/, '');

	let response: Response;
	try {
		response = await fetch(`${trimmed}/api/v1/health`, {
			headers: { accept: 'application/json' },
			// The most common wrong address is not one that refuses — it is a
			// domain that resolves to a host quietly dropping the packets, and
			// that `fetch` never settles at all. Without this the button says
			// "Páruji…" until the app is reloaded, which is the exact failure
			// this whole function exists to replace with a sentence.
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});
	} catch {
		throw new Error('Na téhle adrese nikdo neodpovídá. Zkontroluj ji, nebo připojení.');
	}

	if (!response.ok) throw new Error('Na téhle adrese Prosper server není.');

	const health = (await response.json().catch(() => null)) as HealthResponse | null;
	if (!health?.ok) throw new Error('Na téhle adrese Prosper server není.');

	return health;
}

export async function pair({ baseUrl, code, deviceName }: PairInput): Promise<void> {
	const trimmed = baseUrl.replace(/\/+$/, '');

	// Cheap, and it turns the whole class of "wrong address" mistakes into one
	// sentence that names the actual problem.
	await probe(trimmed);

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
