<script lang="ts">
	/**
	 * The vysvětlivka — the term itself is the control.
	 *
	 * There is no hover on a phone, so a classic tooltip is not available, and a
	 * `?` icon is a second object competing for row space. Instead the term
	 * wears a dashed hairline underline and the standard borrowed 44 px hit
	 * area; tapping it opens the existing Sheet with the term as the title and
	 * two to four sentences inside — closed by pull, backdrop or Esc like every
	 * other sheet. Zero standing height on any screen, and the underline is
	 * self-limiting: a screen wearing five of them looks wrong.
	 *
	 * A term earns a vysvětlivka only when all three hold: it names a rule
	 * whose consequences are invisible on this screen; the honest answer needs
	 * more than one line; and the question arises the moment the term is on
	 * the glass. Otherwise, down the ladder: a one-line answer belongs in a
	 * `.field__hint` or in better label copy, and an answer needed before
	 * first use belongs in the empty state. First-run coaching is rejected
	 * outright — this app explains once, when asked, and gets out of the way.
	 */
	import type { Snippet } from 'svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		/** The term, exactly as the surrounding copy prints it. */
		term: string;
		/** Sheet title, when the inline term's casing is not a heading. */
		title?: string;
		children: Snippet;
	}

	let { term, title, children }: Props = $props();
	let open = $state(false);
</script>

<button type="button" class="explainer" onclick={() => (open = true)}>{term}</button>

<Sheet {open} title={title ?? term} onclose={() => (open = false)}>
	<div class="explainer__body prose">
		{@render children()}
	</div>
</Sheet>

<style>
	/* The term keeps its surroundings' face, size and colour — but always as
	   standard text: never uppercased, even inside a `.u-label` (Petr,
	   2026-08-29). The sentence case plus the dashed hairline is what marks
	   it as a word that answers. */
	.explainer {
		position: relative;
		font: inherit;
		letter-spacing: normal;
		text-transform: none;
		text-align: inherit;
		color: inherit;
		border-bottom: 1px dashed var(--hairline-2);
	}

	/* The borrowed hit area, the same trick as every 24 px control. */
	.explainer::after {
		content: '';
		position: absolute;
		inset: -14px -8px;
	}

	.explainer__body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		font-size: var(--text-base);
	}
</style>
