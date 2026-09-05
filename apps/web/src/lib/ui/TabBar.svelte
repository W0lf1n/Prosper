<script lang="ts">
	/**
	 * The bottom navigation: Domů · Výpis · ⊕ · Přehled · Já.
	 *
	 * Five slots, since the third edition — down from seven cells. The month
	 * and the standing orders became one screen with a switch inside it, and
	 * the goal, the wealth and the settings became cards on a hub. A detail
	 * screen reached from the hub keeps Já lit.
	 *
	 * The disc in the middle is the record screen, which carries no bar of its
	 * own: the keypad owns the bottom of the phone there.
	 *
	 * A frosted pill floating over the page's bottom edge — the page scrolls
	 * under it. `.page` in `app.css` reserves the room (`--page-end`), so the
	 * last row still scrolls clear of it.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from './Icon.svelte';

	type Destination = '/' | '/tape' | '/prehled' | '/ja';

	const tabs: { path: Destination; label: string; icon: IconName; also: string[] }[] = [
		{ path: '/', label: 'Domů', icon: 'home', also: [] },
		{ path: '/tape', label: 'Výpis', icon: 'tape', also: [] },
		{ path: '/prehled', label: 'Přehled', icon: 'month', also: ['/mesic', '/platby'] },
		{ path: '/ja', label: 'Já', icon: 'person', also: ['/cil', '/jmeni', '/nastaveni'] }
	];

	const here = $derived(page.url.pathname.replace(/\/+$/, '') || '/');

	function isCurrent(tab: (typeof tabs)[number]): boolean {
		const own = resolve(tab.path).replace(/\/+$/, '') || '/';
		return (
			here === own || tab.also.some((p) => here === (resolve(p as '/').replace(/\/+$/, '') || '/'))
		);
	}
</script>

<nav class="tabbar" aria-label="Hlavní navigace">
	{#each tabs.slice(0, 2) as tab (tab.path)}
		<a
			class="tab"
			class:tab--on={isCurrent(tab)}
			href={resolve(tab.path)}
			aria-current={isCurrent(tab) ? 'page' : undefined}
		>
			<Icon name={tab.icon} size={24} stroke={1.7} />
			<span class="tab__label">{tab.label}</span>
		</a>
	{/each}

	<a class="record" href={resolve('/zapis')} aria-label="Zapsat">
		<span class="record__disc"><Icon name="plus" size={26} stroke={2.2} /></span>
	</a>

	{#each tabs.slice(2) as tab (tab.path)}
		<a
			class="tab"
			class:tab--on={isCurrent(tab)}
			href={resolve(tab.path)}
			aria-current={isCurrent(tab) ? 'page' : undefined}
		>
			<Icon name={tab.icon} size={24} stroke={1.7} />
			<span class="tab__label">{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.tabbar {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		bottom: calc(var(--tabbar-lift) + env(safe-area-inset-bottom, 0px));
		z-index: var(--z-nav);
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		align-items: center;
		height: var(--tabbar);
		padding: 0 var(--space-2);
		border-radius: var(--radius-full);
		background: var(--glass);
		border: 1px solid var(--glass-edge);
		box-shadow: var(--elev-bar);
		-webkit-backdrop-filter: blur(24px) saturate(1.6);
		backdrop-filter: blur(24px) saturate(1.6);
	}

	/* Without backdrop blur the glass has nothing to frost; go opaque. */
	@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.tabbar {
			background: var(--surface);
		}
	}

	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-width: 0;
		height: var(--tabbar);
		padding: 0;
		color: var(--ink-3);
		text-decoration: none;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.tab__label {
		max-width: 100%;
		font-size: var(--text-2xs);
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab--on {
		color: var(--ink);
	}

	@media (hover: hover) {
		.tab:hover {
			color: var(--ink-2);
		}

		.tab--on:hover {
			color: var(--ink);
		}
	}

	.record {
		display: flex;
		justify-content: center;
		align-items: center;
		height: var(--tabbar);
		text-decoration: none;
	}

	.record__disc {
		display: grid;
		place-items: center;
		width: 52px;
		height: 52px;
		border-radius: var(--radius-full);
		background: var(--signal);
		color: var(--signal-ink);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.record:active .record__disc {
		background: color-mix(in srgb, var(--signal) 85%, var(--ink));
	}
</style>
