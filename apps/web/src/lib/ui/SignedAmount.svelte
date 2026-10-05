<script lang="ts">
	/**
	 * A balance, which may be below zero — Q85.
	 *
	 * A minus typed before the number counts: it is lifted out of the text and
	 * becomes the sign, so the field always holds the magnitude. The decimal
	 * keypad most phones show for `inputmode="decimal"` has no minus key, so
	 * the sign is also a round key inside the field, on the left, where the
	 * minus would be written: tap it and + becomes − and back.
	 * `parseSigned()` in `domain/money.ts` puts the two together again.
	 */
	interface Props {
		/** The magnitude as typed. */
		text: string;
		/** Below zero. */
		negative: boolean;
		label: string;
		placeholder?: string;
	}

	let { text = $bindable(), negative = $bindable(), label, placeholder = '0' }: Props = $props();

	/** "-1 000" is −, 1 000; "+50" is +, 50. A sign anywhere but the front is
	    left for the parser to refuse. */
	function liftSign(event: Event & { currentTarget: HTMLInputElement }) {
		const typed = event.currentTarget.value;
		const sign = /^\s*([-−+])/.exec(typed);
		if (!sign) return;
		negative = sign[1] !== '+';
		text = typed.slice(sign[0].length);
	}
</script>

<div class="field">
	<span class="field__label">{label}</span>
	<div class="signed">
		<button
			type="button"
			class="signed__sign"
			aria-pressed={negative}
			aria-label={negative ? 'V mínusu — přepnout do plusu' : 'V plusu — přepnout do mínusu'}
			onclick={() => (negative = !negative)}
		>
			{negative ? '−' : '+'}
		</button>
		<input
			class="field__input field__input--mono signed__input"
			bind:value={text}
			oninput={liftSign}
			inputmode="decimal"
			{placeholder}
			autocomplete="off"
			aria-label={label}
		/>
	</div>
</div>

<style>
	.signed {
		position: relative;
	}

	.signed__input {
		padding-left: calc(var(--space-2) + 2.25rem + var(--space-2));
	}

	/* A pill on the soft field, raised a step by luminance. */
	.signed__sign {
		position: absolute;
		top: 50%;
		left: var(--space-2);
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--ink);
		font-size: 1.25rem;
		font-weight: 500;
		line-height: 1;
		transform: translateY(-50%);
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.signed__sign:active {
		background: var(--surface-2);
	}

	.signed__sign[aria-pressed='true'] {
		background: var(--ink);
		color: var(--surface);
	}
</style>
