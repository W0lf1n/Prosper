/**
 * The pre-flight probe.
 *
 * `probe` is not part of the sync protocol — it exists so that the one field a
 * person types by hand, on a phone, fails with a sentence about the address
 * rather than a status code. These tests are about the sentences.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultBaseUrl, probe } from './pair';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

let requests: string[];

beforeEach(() => {
	requests = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function answer(next: () => Promise<Response> | Response): void {
	vi.stubGlobal('fetch', (url: string) => {
		requests.push(String(url));
		return Promise.resolve(next());
	});
}

describe('probe', () => {
	it('accepts a server that says it is well', async () => {
		answer(() => json({ ok: true, version: '1.2.3' }));

		const health = await probe('https://prosper.example.com');

		expect(health.version).toBe('1.2.3');
		expect(requests).toEqual(['https://prosper.example.com/api/v1/health']);
	});

	it('strips a trailing slash rather than asking for a doubled path', async () => {
		answer(() => json({ ok: true, version: '1' }));

		await probe('https://prosper.example.com///');

		expect(requests).toEqual(['https://prosper.example.com/api/v1/health']);
	});

	it('names the address, not the status, when something else answers', async () => {
		answer(() => json({ error: 'not found' }, 404));

		await expect(probe('https://example.com')).rejects.toThrow('Prosper server není');
	});

	/**
	 * A page that returns 200 and HTML is the mistake this catches: a mistyped
	 * domain that happens to host something.
	 */
	it('refuses a 200 that is not a health response', async () => {
		answer(() => new Response('<!doctype html>', { status: 200 }));

		await expect(probe('https://example.com')).rejects.toThrow('Prosper server není');
	});

	it('refuses a server that says it is not well', async () => {
		answer(() => json({ ok: false, version: '1' }));

		await expect(probe('https://prosper.example.com')).rejects.toThrow('Prosper server není');
	});

	it('says the address is unreachable when the request never lands', async () => {
		answer(() => {
			throw new TypeError('Failed to fetch');
		});

		await expect(probe('https://prosper.example.com')).rejects.toThrow('nikdo neodpovídá');
	});
});

describe('defaultBaseUrl', () => {
	it('is the origin the app was served from', () => {
		vi.stubGlobal('location', { origin: 'https://prosper.example.com' });

		expect(defaultBaseUrl()).toBe('https://prosper.example.com');
	});

	/**
	 * A `file://` or `blob:` origin is not somewhere a server can be, and
	 * offering it as a default would be offering a guaranteed failure.
	 */
	it('is empty when the origin is not one a server could answer on', () => {
		vi.stubGlobal('location', { origin: 'null' });

		expect(defaultBaseUrl()).toBe('');
	});
});
