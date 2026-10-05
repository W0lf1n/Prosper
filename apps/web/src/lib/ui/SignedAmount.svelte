<script lang="ts">
	/**
	 * A balance, which may be below zero — Q85.
	 *
	 * The decimal keypad most phones show for `inputmode="decimal"` has digits
	 * and a comma and no minus key, so "-1 000" could not be typed and an
	 * account in debt could not be opened or reconciled. The sign is a pill
	 * beside the field instead, in the words a bank balance is spoken in: _v
	 * plusu_, _v mínusu_. The field holds the magnitude; `parseSigned()` in
	 * `domain/money.ts` puts the two back together, and a minus typed by hand
	 * still counts.
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
</script>

<div class="field">
	<span class="field__label">{label}</span>
	<div class="signed">
		<input
			class="field__input field__input--mono"
			bind:value={text}
			inputmode="decimal"
			{placeholder}
			autocomplete="off"
			aria-label={label}
		/>
		<div class="seg seg--soft signed__sign" role="group" aria-label="Kladný, nebo záporný">
			<button
				type="button"
				class="seg__item"
				aria-pressed={!negative}
				onclick={() => (negative = false)}
			>
				V plusu
			</button>
			<button
				type="button"
				class="seg__item"
				aria-pressed={negative}
				onclick={() => (negative = true)}
			>
				V mínusu
			</button>
		</div>
	</div>
</div>

<style>
	.signed {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 11.5rem;
		gap: var(--space-2);
		align-items: center;
	}

	.signed__sign {
		align-self: stretch;
		align-items: stretch;
	}

	@media (max-width: 360px) {
		.signed {
			grid-template-columns: 1fr;
		}
	}
</style>
