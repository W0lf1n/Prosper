/**
 * Identifiers.
 *
 * The client generates every id (PROJECT-PLAN §11.3). The server never assigns
 * one. UUIDv7 so ids sort by creation time, which makes them usable as a
 * secondary sort key and keeps IndexedDB indexes append-friendly.
 */

let lastTimestamp = 0;
let sequence = 0;

/** RFC 9562 UUIDv7: 48-bit millisecond timestamp, 12-bit counter, 62 random bits. */
export function uuidv7(): string {
	const now = Date.now();

	if (now === lastTimestamp) {
		sequence = (sequence + 1) & 0xfff;
		// counter wrapped inside the same millisecond — borrow the next one
		if (sequence === 0) lastTimestamp = now + 1;
	} else {
		lastTimestamp = Math.max(now, lastTimestamp);
		sequence = randomBytes(2)[0]! & 0x0fff;
	}

	const timestamp = lastTimestamp;
	const bytes = new Uint8Array(16);

	// 48-bit big-endian timestamp
	bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
	bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
	bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
	bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
	bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
	bytes[5] = timestamp & 0xff;

	// version 7 + 12-bit monotonic counter
	bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
	bytes[7] = sequence & 0xff;

	const random = randomBytes(8);
	// variant 10xxxxxx
	bytes[8] = 0x80 | (random[0]! & 0x3f);
	for (let i = 1; i < 8; i++) bytes[8 + i] = random[i]!;

	return format(bytes);
}

/** A stable identifier for this browser profile. Written once, then read forever. */
export function newDeviceId(): string {
	return uuidv7();
}

function randomBytes(length: number): Uint8Array {
	const buffer = new Uint8Array(length);
	crypto.getRandomValues(buffer);
	return buffer;
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function format(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < 16; i++) {
		out += HEX[bytes[i]!];
		if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
	}
	return out;
}
