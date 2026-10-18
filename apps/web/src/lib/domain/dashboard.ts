/**
 * Domů, arranged by hand — which cards it shows, and in what order
 * (2026-10-18, a prototype).
 *
 * Three things stay where they are and are not on the list: the month's net
 * at the top, because Domů leading with it is the Tracking law's own line in
 * `CLAUDE.md`; and the two decks — dues and holds — because they appear only
 * when something waits for a tap, and a waiting payment that can be hidden is
 * a payment that gets missed. Everything under them is his to arrange.
 *
 * Stored as the list of cards shown, in order, in a synced `Layout` row
 * (Q95), so every paired device shows the same Domů. A card not on it is
 * hidden — so a card a later build adds arrives hidden, offered under
 * _Přidat_, rather than appearing on a screen he has arranged. Until he
 * arranges anything there is no row, and every card is shown.
 *
 * Pure. No Dexie, no fetch, no DOM.
 */

export type WidgetId = 'goal' | 'wealth' | 'recent' | 'pace' | 'calendar' | 'split' | 'balance';

export interface WidgetInfo {
	title: string;
	/** One line in the editor: what the card is for. */
	note: string;
}

/** The catalogue, in the order the editor offers what is hidden. */
export const WIDGETS: Record<WidgetId, WidgetInfo> = {
	goal: { title: 'Cíl', note: 'Kolik jsi na něj dal tenhle měsíc' },
	wealth: { title: 'Jmění celkem', note: 'Účty a investice dohromady' },
	recent: { title: 'Poslední záznamy', note: 'Tři nejnovější řádky, ťukni a uprav' },
	pace: { title: 'Tempo útraty', note: 'Tenhle měsíc proti minulému ke stejnému dni' },
	calendar: { title: 'Kalendář útraty', note: 'Měsíc po dnech — čím tmavší, tím dražší' },
	split: { title: 'Rozdělení příjmu', note: '10 / 10 / 10 / 70 jako čtyři ukazatele' },
	balance: { title: 'Vývoj zůstatku', note: 'Den, týden, měsíc, rok, nebo všechno' }
};

export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

/**
 * Every card, until he arranges it (Q95: "all" — the four charts are on for
 * everybody who has not chosen otherwise). The cards that were on Domů
 * before come first, so the top of the screen is where it always was.
 */
export const DEFAULT_HOME: readonly WidgetId[] = [
	'goal',
	'wealth',
	'recent',
	'pace',
	'calendar',
	'split',
	'balance'
];

export interface HomeLayout {
	/** Shown, top to bottom. */
	widgets: WidgetId[];
}

function isWidgetId(value: unknown): value is WidgetId {
	return typeof value === 'string' && Object.hasOwn(WIDGETS, value);
}

/** The stored layout, read tolerantly: unknown or repeated ids are dropped. */
export function readHomeLayout(stored: unknown): HomeLayout {
	const raw = (stored && typeof stored === 'object' ? stored : null) as {
		widgets?: unknown;
	} | null;
	if (!raw || !Array.isArray(raw.widgets)) return { widgets: [...DEFAULT_HOME] };
	return { widgets: [...new Set(raw.widgets.filter(isWidgetId))] };
}

/**
 * The arrangement among the synced rows: the newest live one. Two devices
 * that each arranged Domů before pairing bring a row each; the later
 * arrangement wins, the same last-write-wins the merge itself uses.
 */
export function newestLayout<T extends { updatedAt: string; deviceId: string; isDeleted: boolean }>(
	rows: readonly T[]
): T | null {
	let best: T | null = null;
	for (const row of rows) {
		if (row.isDeleted) continue;
		if (
			!best ||
			row.updatedAt > best.updatedAt ||
			(row.updatedAt === best.updatedAt && row.deviceId > best.deviceId)
		) {
			best = row;
		}
	}
	return best;
}

/** What can be added, in catalogue order. */
export function hiddenWidgets(layout: HomeLayout): WidgetId[] {
	return WIDGET_IDS.filter((id) => !layout.widgets.includes(id));
}

/** One step up (−1) or down (+1); at either end it stays where it is. */
export function moveWidget(layout: HomeLayout, id: WidgetId, by: -1 | 1): HomeLayout {
	const from = layout.widgets.indexOf(id);
	const to = from + by;
	if (from < 0 || to < 0 || to >= layout.widgets.length) return layout;
	const widgets = [...layout.widgets];
	[widgets[from], widgets[to]] = [widgets[to]!, widgets[from]!];
	return { widgets };
}

/** Added at the bottom — the place a new thing is looked for. */
export function showWidget(layout: HomeLayout, id: WidgetId): HomeLayout {
	return layout.widgets.includes(id) ? layout : { widgets: [...layout.widgets, id] };
}

export function hideWidget(layout: HomeLayout, id: WidgetId): HomeLayout {
	return { widgets: layout.widgets.filter((w) => w !== id) };
}
