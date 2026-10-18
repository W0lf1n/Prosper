<script lang="ts">
	/**
	 * Kalendář útraty — the month as a field of dots, each in as much ink as
	 * its day cost (`domain/charts.ts` → `spendCalendar`, `docs/CHARTS.md` §a).
	 *
	 * Pared down on 2026-10-18: no day numbers, no legend, no month label —
	 * the pattern is the point, and the one line under it carries the words.
	 * Ink, not a hue, because money out has none in this app: four steps, the
	 * quartiles of the month's own spending days. A day that cost nothing is
	 * a mint dot, a day still to come an empty ring, today a ring in ink. A tap
	 * on a dot says what the day cost; tapping it again goes back.
	 */
	import { capitalize, counted, DAYS, RECORDS } from '$lib/domain/czech';
	import { formatDayHeading } from '$lib/domain/datetime';
	import type { CalendarDay, SpendCalendar } from '$lib/domain/charts';
	import { formatMoney } from '$lib/domain/money';

	interface Props {
		calendar: SpendCalendar;
		code: string;
	}

	let { calendar, code }: Props = $props();

	const WEEKDAYS = ['P', 'Ú', 'S', 'Č', 'P', 'S', 'N'];

	let picked = $state<string | null>(null);
	const chosen = $derived(
		picked ? (calendar.weeks.flat().find((d) => d?.date === picked) ?? null) : null
	);

	function describe(day: CalendarDay): string {
		const when = capitalize(formatDayHeading(day.date));
		if (day.isFuture) return `${when} · ještě nebyl`;
		if (day.spent <= 0) return `${when} · bez výdaje`;
		return `${when} · ${formatMoney(day.spent, { code })} · ${counted(day.count, RECORDS)}`;
	}
</script>

<section class="card">
	<div class="card__head">
		<h2 class="label">Kalendář útraty</h2>
		<span class="label">{formatMoney(calendar.total, { code })}</span>
	</div>

	<div class="cal" role="grid" aria-label="Útrata po dnech">
		<div class="cal__week" role="row">
			{#each WEEKDAYS as name, i (i)}
				<span class="cal__name" role="columnheader">{name}</span>
			{/each}
		</div>
		{#each calendar.weeks as week, w (w)}
			<div class="cal__week" role="row">
				{#each week as day, d (day?.date ?? `pad-${w}-${d}`)}
					{#if day}
						<button
							type="button"
							role="gridcell"
							class="cal__day"
							aria-label={describe(day).replace(' · ', ': ')}
							aria-selected={picked === day.date}
							onclick={() => (picked = picked === day.date ? null : day.date)}
						>
							<span
								class="cal__dot"
								class:cal__dot--quiet={!day.isFuture && day.level === 0}
								class:cal__dot--future={day.isFuture}
								class:cal__dot--today={day.isToday}
								class:cal__dot--picked={picked === day.date}
								data-level={day.level}
							></span>
						</button>
					{:else}
						<span class="cal__day" role="gridcell"></span>
					{/if}
				{/each}
			</div>
		{/each}
	</div>

	<p class="cal__line" aria-live="polite">
		{#if chosen}
			{describe(chosen)}
		{:else if calendar.peak}
			Nejvíc {formatDayHeading(calendar.peak.date)} · {formatMoney(calendar.peak.spent, {
				code
			})} · {counted(calendar.quiet, DAYS)} bez výdaje
		{:else}
			Tenhle měsíc zatím neodešla ani koruna.
		{/if}
	</p>
</section>

<style>
	.cal {
		display: flex;
		flex-direction: column;
	}

	.cal__week {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
	}

	.cal__name {
		padding-bottom: 2px;
		font-size: var(--text-xs);
		color: var(--ink-3);
		text-align: center;
	}

	/* The cell is the target — a whole column wide, 32 tall; the dot is the mark. */
	.cal__day {
		display: grid;
		place-items: center;
		height: 32px;
	}

	.cal__dot {
		width: 18px;
		height: 18px;
		border-radius: var(--radius-full);
		background: var(--surface-3);
	}

	.cal__dot[data-level='1'] {
		background: var(--heat-1);
	}

	.cal__dot[data-level='2'] {
		background: var(--heat-2);
	}

	.cal__dot[data-level='3'] {
		background: var(--heat-3);
	}

	.cal__dot[data-level='4'] {
		background: var(--heat-4);
	}

	.cal__dot--quiet {
		background: var(--in-wash);
	}

	.cal__dot--future {
		background: transparent;
		border: 1px solid var(--hairline-2);
	}

	.cal__dot--today,
	.cal__dot--picked {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}

	.cal__line {
		font-size: var(--text-sm);
		color: var(--ink-2);
	}
</style>
