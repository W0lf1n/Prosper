/**
 * The five rooms of Nastavení, as the hub lists them: a title, a
 * one-line live summary, an icon and the page it opens. One function feeds
 * both screens, so the two lists cannot drift apart.
 */

import { CATEGORIES, RECORDS, counted } from '$lib/domain/czech';
import { formatMoney, type Minor } from '$lib/domain/money';
import type { Account } from '$lib/domain/types';
import { SYNC_LABEL, type SyncState } from '$lib/sync/status.svelte';
import type { IconName } from './Icon.svelte';
import { THEME_LABEL, type Theme } from './theme';

export type SettingsPage = 'ucty' | 'kategorie' | 'vzhled' | 'sync' | 'data';

export interface SettingsRow {
	id: SettingsPage;
	href: `/nastaveni/${SettingsPage}`;
	title: string;
	/** What is in the room right now, in one line. */
	sub: string;
	icon: IconName;
}

export interface SettingsFacts {
	/** The account the keypad writes to, and what is on it. */
	account: Account | null;
	balance: Minor | null;
	/** Live, unarchived buckets. */
	categoryCount: number;
	theme: Theme;
	syncState: SyncState;
	/** Live rows — never the tombstones. */
	txnCount: number;
}

export function settingsRows(facts: SettingsFacts): SettingsRow[] {
	const { account, balance } = facts;
	return [
		{
			id: 'ucty',
			href: '/nastaveni/ucty',
			title: 'Účty',
			sub:
				account && balance !== null
					? `${account.name} · ${formatMoney(balance, { code: account.currency })}`
					: (account?.name ?? '—'),
			icon: 'wallet'
		},
		{
			id: 'kategorie',
			href: '/nastaveni/kategorie',
			title: 'Kategorie',
			sub: `${counted(facts.categoryCount, CATEGORIES)}, ikony a barvy`,
			icon: 'tag'
		},
		{
			id: 'vzhled',
			href: '/nastaveni/vzhled',
			title: 'Vzhled',
			sub: THEME_LABEL[facts.theme],
			icon: 'sun-moon'
		},
		{
			id: 'sync',
			href: '/nastaveni/sync',
			title: 'Synchronizace',
			sub: SYNC_LABEL[facts.syncState],
			icon: 'refresh-cw'
		},
		{
			id: 'data',
			href: '/nastaveni/data',
			title: 'Data',
			sub: `${counted(facts.txnCount, RECORDS)} · záloha a export`,
			icon: 'database'
		}
	];
}
