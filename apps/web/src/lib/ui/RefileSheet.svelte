<script lang="ts">
	/**
	 * Přebrat OSTATNÍ — `TRIMMING-AND-TRAINING.md` T4.
	 *
	 * The `other-overflow` check could say the dumping ground was too big since
	 * P1 and could do nothing about it. This is the doing: the month's rows,
	 * biggest first, each with the bucket the vocabulary would put it in and a
	 * button that puts it there.
	 *
	 * The list **shrinks as you work**, because the rows are read back out of the
	 * live query rather than held in a snapshot. Watching it empty is the entire
	 * reward on offer here, and a list that stayed the same length while you
	 * worked would take that away.
	 *
	 * Nothing here is bulk. There is no "move all" and there will not be one: the
	 * suggestion comes from a hand-written dictionary that is right most of the
	 * time, and "most of the time" applied to fifty rows at once is how a bucket
	 * that explained nothing becomes four buckets that explain nothing.
	 */
	import { formatShortDate } from '$lib/domain/datetime';
	import { neg } from '$lib/domain/money';
	import { refileTargets, summariseDrain, type RefileCandidate } from '$lib/domain/refile';
	import { RECORDS, counted } from '$lib/domain/czech';
	import type { Category } from '$lib/domain/types';
	import Money from './Money.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		/** The bucket being drained. Null closes the sheet. */
		bucket: Category | null;
		/** Live — re-derived on every write, so the list empties as you go. */
		candidates: RefileCandidate[];
		categories: Category[];
		onrefile: (txnId: string, categoryId: string) => Promise<void>;
		onclose: () => void;
	}

	let { open, bucket, candidates, categories, onrefile, onclose }: Props = $props();

	const summary = $derived(summariseDrain(candidates));
	const targets = $derived(bucket ? refileTargets(categories, bucket.id) : []);

	/** Which row has its picker open. Only one at a time — this is a phone. */
	let picking = $state<string | null>(null);

	$effect(() => {
		if (!open) picking = null;
	});
</script>

<Sheet {open} title={bucket ? `Přebrat ${bucket.name}` : 'Přebrat'} {onclose}>
	<div class="drain">
		{#if candidates.length === 0}
			<p class="done">
				Hotovo — v {bucket?.name ?? 'téhle kategorii'} tenhle měsíc nic nezbylo.
			</p>
		{:else}
			<p class="lead">
				<strong>{counted(summary.remaining, RECORDS)}</strong> za
				<Money value={neg(summary.total)} size="sm" bold />. Co z toho má vlastní kategorii?
			</p>

			<ul class="rows">
				{#each candidates as candidate (candidate.txn.id)}
					<li class="row">
						<div class="row__head">
							<span class="row__payee">{candidate.txn.payee || 'bez popisu'}</span>
							<Money value={candidate.txn.amount} size="base" bold />
						</div>
						<span class="row__date">{formatShortDate(candidate.txn.date)}</span>

						{#if picking === candidate.txn.id}
							<!--
							  The full list, for a row the dictionary could not place — or for
							  one where it guessed and the guess was wrong.
							-->
							<div class="picker">
								{#each targets as target (target.id)}
									<button
										type="button"
										class="picker__option"
										onclick={() => {
											picking = null;
											void onrefile(candidate.txn.id, target.id);
										}}
									>
										{target.name}
									</button>
								{/each}
								<button type="button" class="picker__cancel" onclick={() => (picking = null)}>
									Zpět
								</button>
							</div>
						{:else}
							<div class="row__actions">
								{#if candidate.suggestion}
									<!--
									  An arrow rather than "Do POTRAVINY", which would be wrong:
									  `do` takes the genitive and the bucket names are stored in
									  the nominative. The entry screen has the same bug in
									  `Dát do JÍDLO` and it is open in `TODO.md`; this is the
									  reword that dodges it, and evidence that the reword works.
									-->
									<button
										type="button"
										class="btn btn--primary row__take"
										onclick={() => void onrefile(candidate.txn.id, candidate.suggestion!.id)}
									>
										→ {candidate.suggestion.name}
									</button>
								{/if}
								<button
									type="button"
									class="btn btn--quiet row__else"
									onclick={() => (picking = candidate.txn.id)}
								>
									{candidate.suggestion ? 'Jinam' : 'Vybrat kategorii'}
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			<p class="note">
				Co tu necháš, to sem podle tebe patří. Kategorii jde stejně změnit kdykoliv ve výpisu.
			</p>
		{/if}
	</div>
</Sheet>

<style>
	.drain {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.lead {
		font-size: var(--text-md);
		line-height: var(--leading-base);
		color: var(--ink-2);
		text-wrap: pretty;
	}

	.lead strong {
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.done {
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background: var(--in-wash);
		font-size: var(--text-base);
		color: var(--ink);
		text-align: center;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}

	.row__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.row__payee {
		min-width: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row__date {
		font-size: var(--text-xs);
		color: var(--ink-3);
	}

	.row__actions {
		display: flex;
		gap: var(--space-2);
	}

	.row__take {
		flex: 1;
	}

	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.picker__option,
	.picker__cancel {
		min-height: var(--touch);
		padding-inline: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-full);
		background: var(--raised);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink-2);
	}

	.picker__cancel {
		color: var(--ink-3);
	}

	@media (hover: hover) {
		.picker__option:hover {
			border-color: var(--signal);
			color: var(--ink);
		}
	}

	.note {
		font-size: var(--text-xs);
		line-height: var(--leading-base);
		color: var(--ink-3);
		text-wrap: pretty;
	}
</style>
