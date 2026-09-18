/**
 * The tick under the thumb — the only place the app asks the phone to move.
 *
 * Android has the Vibration API. iOS Safari has never shipped it, but since
 * 17.4 a native `<input type="checkbox" switch>` plays the system's own tick
 * whenever it toggles, and a click on its label toggles it — even a label
 * that is `display: none`. The technique is the one from web-haptics
 * (haptics.lochie.me, MIT), hand-rolled here because it is twenty lines and
 * a package is a bundle-size decision.
 *
 * Both paths need a user gesture. Android's is sticky, so a confirmation
 * after an awaited save still lands; iOS only honours the tick inside the
 * handler itself, and may drop one that comes after an `await`. A tick that
 * must be felt — a key — is called before anything else happens. Anywhere
 * without either — a desktop, an older iPhone — it does nothing, quietly.
 */

/** Whether the phone has the Vibration API — false on every iPhone. */
export const vibrates = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let label: HTMLLabelElement | null = null;

function switchLabel(): HTMLLabelElement {
	if (label) return label;

	const input = document.createElement('input');
	input.type = 'checkbox';
	input.setAttribute('switch', '');
	input.id = 'haptic-switch';
	input.tabIndex = -1;
	input.style.display = 'none';

	label = document.createElement('label');
	label.htmlFor = input.id;
	label.ariaHidden = 'true';
	label.style.display = 'none';
	label.appendChild(input);
	document.body.appendChild(label);

	return label;
}

/**
 * `pattern` is what `navigator.vibrate` takes: milliseconds, or on/off
 * milliseconds alternating. iOS cannot shape its tick, only repeat it: there
 * every "on" of a pattern is one tick at the moment it would have started.
 * The first is inside the gesture; the later ones ride on it, which Safari
 * allows for a moment after a tap and not at all without one.
 */
export function haptic(pattern: number | number[] = 8): void {
	if (typeof navigator === 'undefined' || typeof document === 'undefined') return;

	if (vibrates) {
		navigator.vibrate(pattern);
		return;
	}

	const tick = switchLabel();
	tick.click();

	if (typeof pattern === 'number') return;
	let at = 0;
	for (let i = 2; i < pattern.length; i += 2) {
		at += pattern[i - 2] + pattern[i - 1];
		setTimeout(() => tick.click(), at);
	}
}
