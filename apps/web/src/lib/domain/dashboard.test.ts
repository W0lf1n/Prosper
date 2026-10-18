import { describe, expect, it } from 'vitest';
import {
	DEFAULT_HOME,
	WIDGET_IDS,
	hiddenWidgets,
	hideWidget,
	moveWidget,
	newestLayout,
	readHomeLayout,
	showWidget
} from './dashboard';

describe('the layout of Domů', () => {
	it('shows every card until it is arranged', () => {
		expect(readHomeLayout(undefined).widgets).toEqual(DEFAULT_HOME);
		expect(DEFAULT_HOME).toEqual(WIDGET_IDS);
		expect(readHomeLayout({ widgets: 'goal' }).widgets).toEqual(DEFAULT_HOME);
	});

	it('keeps what was saved, dropping what this build does not know and any repeat', () => {
		expect(readHomeLayout({ widgets: ['pace', 'wat', 'goal', 'pace'] }).widgets).toEqual([
			'pace',
			'goal'
		]);
	});

	it('may be emptied — the net and the decks stay regardless', () => {
		expect(readHomeLayout({ widgets: [] }).widgets).toEqual([]);
	});

	it('offers what is hidden, in catalogue order', () => {
		const hidden = hiddenWidgets({ widgets: ['recent', 'goal'] });
		expect(hidden).toEqual(WIDGET_IDS.filter((id) => id !== 'recent' && id !== 'goal'));
	});

	it('moves a card one step, and not past either end', () => {
		const layout = { widgets: ['goal', 'wealth', 'recent'] as const }.widgets;
		expect(moveWidget({ widgets: [...layout] }, 'recent', -1).widgets).toEqual([
			'goal',
			'recent',
			'wealth'
		]);
		expect(moveWidget({ widgets: [...layout] }, 'goal', -1).widgets).toEqual(layout);
		expect(moveWidget({ widgets: [...layout] }, 'recent', 1).widgets).toEqual(layout);
		expect(moveWidget({ widgets: [...layout] }, 'pace', 1).widgets).toEqual(layout);
	});

	it('adds at the bottom, once, and hides by removing', () => {
		const shown = showWidget({ widgets: ['goal'] }, 'calendar');
		expect(shown.widgets).toEqual(['goal', 'calendar']);
		expect(showWidget(shown, 'calendar').widgets).toEqual(['goal', 'calendar']);
		expect(hideWidget(shown, 'goal').widgets).toEqual(['calendar']);
	});
});

describe('the synced arrangement', () => {
	const row = (id: string, updatedAt: string, deviceId = 'a', isDeleted = false) => ({
		id,
		updatedAt,
		deviceId,
		isDeleted,
		widgets: []
	});

	it('is the newest live row, ties to the larger device id', () => {
		expect(newestLayout([])).toBeNull();
		expect(newestLayout([row('1', '2026-10-18T10:00Z'), row('2', '2026-10-18T11:00Z')])!.id).toBe(
			'2'
		);
		expect(
			newestLayout([row('1', '2026-10-18T10:00Z', 'b'), row('2', '2026-10-18T10:00Z', 'a')])!.id
		).toBe('1');
		expect(
			newestLayout([row('1', '2026-10-18T10:00Z'), row('2', '2026-10-18T11:00Z', 'a', true)])!.id
		).toBe('1');
	});
});
