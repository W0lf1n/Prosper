/**
 * One transient message at a time, with an optional undo.
 *
 * Undo matters more than it looks: a mis-tapped amount that cannot be taken
 * back immediately is exactly the friction that killed the spreadsheet.
 *
 * Money gets its own shape. Saving 249 Kč of lunch and saving a settings change
 * are not the same event, and the confirmation should not look the same either.
 */

import type { Minor } from '$lib/domain/money';

export interface Toast {
	id: number;
	message: string;
	tone: 'neutral' | 'out' | 'in' | 'flag';
	/** Present for money events. Rendered large, in the direction's colour. */
	amount?: Minor;
	/** Currency of the account the money moved on. CZK when absent. */
	code?: string;
	undo?: () => void | Promise<void>;
	/**
	 * How long it stays. The card draws it as a hairline running out along its
	 * bottom edge, because the only question a toast with an undo raises is
	 * "how long have I got" — and answering it costs one pixel of height.
	 */
	ms: number;
}

let current = $state<Toast | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

interface ShowOptions {
	tone?: Toast['tone'];
	undo?: Toast['undo'];
	ms?: number;
}

function present(toast: Omit<Toast, 'id' | 'ms'>, ms: number) {
	clearTimeout(timer);
	const id = ++nextId;
	current = { ...toast, id, ms };
	timer = setTimeout(() => {
		if (current?.id === id) current = null;
	}, ms);
}

export const toast = {
	get current() {
		return current;
	},

	show(message: string, options: ShowOptions = {}) {
		present(
			{ message, tone: options.tone ?? 'neutral', undo: options.undo },
			options.ms ?? (options.undo ? 6000 : 2600)
		);
	},

	/**
	 * Money left, or money arrived. The amount is the message; `message` is only
	 * the small line under it saying what it was.
	 */
	money(
		amount: Minor,
		options: { message?: string; code?: string; undo?: Toast['undo']; ms?: number } = {}
	) {
		present(
			{
				message: options.message ?? '',
				tone: amount < 0 ? 'out' : 'in',
				amount,
				code: options.code,
				undo: options.undo
			},
			options.ms ?? (options.undo ? 6000 : 3200)
		);
	},

	dismiss() {
		clearTimeout(timer);
		current = null;
	}
};
