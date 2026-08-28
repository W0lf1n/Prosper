<script lang="ts">
	/**
	 * The Targeting law, on the launch route (PROJECT-PLAN §2.2).
	 *
	 * One line, always there, on the screen he opens twenty times a week. The
	 * point is not the number — the number is on `/cil`. The point is that the
	 * goal is impossible to stop seeing, which is the difference between a target
	 * and a thing you wrote down in January.
	 *
	 * With no goal it is still one line, and it says so: an empty strip is a
	 * question, not a blank.
	 */
	import { resolve } from '$app/paths';
	import { formatMoney } from '$lib/domain/money';
	import type { GoalStatus } from '$lib/domain/goals';
	import Icon from './Icon.svelte';

	interface Props {
		status: GoalStatus | null;
	}

	let { status }: Props = $props();

	const tone = $derived(
		!status
			? 'none'
			: status.isComplete
				? 'done'
				: status.pace === 'done'
					? 'done'
					: status.pace === 'behind' || status.isOverdue
						? 'behind'
						: 'on'
	);

	/** The right-hand line: what is still missing, in the units he acts in. */
	const trailing = $derived.by(() => {
		if (!status) return '';
		if (status.isComplete) return 'hotovo';
		if (status.monthRemaining === 0) return 'měsíc splněn';
		return `chybí ${formatMoney(status.monthRemaining, { currency: false })}`;
	});
</script>

{#if status}
	<a class="strip" href={resolve('/cil')} data-tone={tone}>
		<span class="strip__name">{status.goal.name}</span>

		<span class="strip__bar" aria-hidden="true">
			<span class="strip__fill" style="width: {status.monthPercent}%"></span>
		</span>

		<span class="strip__numbers">
			<span class="strip__money"
				>{formatMoney(status.monthSaved, { currency: false })}<span class="strip__of"
					>/{formatMoney(status.monthTarget, { currency: false })}</span
				></span
			>
			<span class="strip__note">{trailing}</span>
		</span>
	</a>
{:else}
	<a class="strip strip--empty" href={resolve('/cil')}>
		<span class="strip__name">Nastav cíl</span>
		<span class="strip__note strip__note--wide">Nenapsaný cíl je jen přání.</span>
		<span class="strip__go"><Icon name="chevron-right" size={16} /></span>
	</a>
{/if}

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		/* A full-width row link is still a target: 44 px is the floor here too. */
		min-height: var(--touch);
		padding-top: var(--space-3);
		color: inherit;
		text-decoration: none;
	}

	.strip__name {
		flex: 0 1 auto;
		min-width: 0;
		font-size: var(--text-sm);
		font-weight: 400;
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/**
	 * Thin on purpose: this is a reminder, not a dashboard — which is also why
	 * it is the first thing to give way. On a narrow column the meter shrinks to
	 * nothing before a single digit of the figure beside it is lost.
	 */
	.strip__bar {
		flex: 1 1 0;
		min-width: 0;
		height: 3px;
		border-radius: var(--radius-full);
		background: var(--surface-3);
		overflow: hidden;
	}

	.strip__fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-full);
		background: var(--ink-3);
		/* Width, not `scaleX`: these are pill-shaped, and scaling one horizontally
		   squashes the radius on its end into an ellipse. They animate once, when
		   the figures load or change, so there is no layout cost worth the
		   distortion. */
		transition: width var(--dur-slow) var(--ease-out);
	}

	.strip__numbers {
		/* Shrinkable, but last in the queue: the meter and the goal's name both
		   give way before this does. */
		flex: 0 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1.25;
	}

	.strip__money {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: var(--track-tight);
		color: var(--ink);
		white-space: nowrap;
	}

	.strip__of {
		font-weight: 400;
		color: var(--ink-3);
	}

	.strip__note {
		font-size: var(--text-2xs);
		color: var(--ink-3);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.strip__note--wide {
		flex: 1;
		text-align: right;
	}

	.strip__go {
		flex: none;
		display: grid;
		place-items: center;
		color: var(--ink-3);
		transition: transform var(--dur-base) var(--ease-out);
	}

	/* Behind is the only state that earns a colour. Everything else stays quiet:
	   a strip that shouts on a good month has nothing left for a bad one. */
	.strip[data-tone='behind'] .strip__fill {
		background: var(--flag);
	}

	.strip[data-tone='behind'] .strip__note {
		color: var(--flag);
	}

	.strip[data-tone='done'] .strip__fill {
		background: var(--in);
	}

	.strip[data-tone='done'] .strip__note {
		color: var(--in);
	}

	.strip--empty .strip__name {
		color: var(--signal);
		font-weight: 600;
	}

	@media (hover: hover) {
		.strip--empty:hover .strip__go {
			transform: translateX(2px);
			color: var(--signal);
		}
	}

	/**
	 * Short screens: the keypad stays above the fold, so the reminder folds onto
	 * one line instead. It still says the goal's name and where the month stands,
	 * which is the whole job.
	 */
	@media (max-height: 860px) {
		.strip {
			/* A full-width row link, 302 px across — the height can come down to
			   the size of the line it carries and it is still an easy target. */
			min-height: 36px;
			padding-top: var(--space-1);
			gap: var(--space-2);
		}

		.strip__numbers {
			flex-direction: row;
			align-items: baseline;
			gap: var(--space-2);
		}
	}
</style>
