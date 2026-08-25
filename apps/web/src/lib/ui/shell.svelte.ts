/**
 * What the route has parked on the bottom edge.
 *
 * The toast is the app's one overlay and the bottom edge is the one place
 * every screen puts something you must be able to hit. Screens with fixed
 * furniture of a known height declare it in CSS (`app.css` does the tab bar).
 * The entry screen cannot: the keypad's height is a `dvh` clamp times five
 * rows, so it is only knowable after layout — and it is three hundred pixels
 * tall, which is exactly the case where getting it wrong parks the
 * confirmation on top of the save button.
 *
 * So the screen measures its own floor and says so, and the shell turns that
 * into the toast's stand-off. `null` means "nothing to declare": the CSS rules
 * in `app.css` decide, which is what every other screen wants.
 */

let bottomInset = $state<string | null>(null);

export const shell = {
	get bottomInset() {
		return bottomInset;
	},

	/**
	 * A CSS length: how far above the app's bottom edge the toast has to start,
	 * before the safe-area inset the toast adds for itself. A length rather than
	 * a number, so the route measures only the part that cannot be known ahead
	 * of layout and keeps the spacing in tokens. `null` hands the say back to
	 * the cascade.
	 */
	set bottomInset(value: string | null) {
		bottomInset = value;
	}
};
