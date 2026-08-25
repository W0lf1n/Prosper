/**
 * The room reacts.
 *
 * A saved transaction is the one event this app exists to produce, and until
 * now the whole of its feedback was a card sliding up from the bottom edge.
 * That is a receipt, not a consequence. Money leaving and money arriving are
 * opposite facts and they should not feel the same in the hand.
 *
 * So the app itself takes the colour for three-quarters of a second: coral
 * draining down and out through the bottom edge when something left, mint
 * rising from that same edge when something arrived. It is a wash over the
 * furniture, never a fill — the number and the keypad stay readable through
 * it, because the app is used in the dark and a full-screen flash at night is
 * an assault, not a confirmation.
 *
 * Deliberately separate from `toast`: the toast is a message with an undo and
 * a lifetime of its own, this is a reflex. They happen to fire together on
 * save, and either can fire without the other. `Scenery.svelte` paints it.
 */

export type Flash = {
	id: number;
	/** Which way the money went. `out` drains, `in` rises. */
	direction: 'out' | 'in';
};

/** Long enough to outlive the longest keyframe below, and no longer. */
const DWELL = 900;

let current = $state<Flash | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

export const scene = {
	get current() {
		return current;
	},

	flash(direction: Flash['direction']) {
		clearTimeout(timer);
		const id = ++nextId;
		current = { id, direction };
		timer = setTimeout(() => {
			if (current?.id === id) current = null;
		}, DWELL);
	},

	clear() {
		clearTimeout(timer);
		current = null;
	}
};
