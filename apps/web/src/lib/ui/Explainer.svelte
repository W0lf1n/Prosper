<script lang="ts">
	/**
	 * The vysvětlivka — the term itself is the control.
	 *
	 * There is no hover on a phone, so a classic tooltip is not available, and
	 * a `?` icon is a second object competing for row space. Instead the term
	 * wears a dashed hairline underline and the standard borrowed 44 px hit
	 * area; tapping it opens the sheet with the term as the title and two to
	 * four sentences inside. Zero standing height on any screen.
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
	.explainer {
		position: relative;
		font: inherit;
		letter-spacing: inherit;
		text-align: inherit;
		color: inherit;
		border-bottom: 1px dashed var(--hairline-2);
	}

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
		color: var(--ink);
	}
</style>
