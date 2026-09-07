<script lang="ts">
	/**
	 * The bottom navigation: Domů · Výpis · ⊕ · Přehled · Nastavení.
	 *
	 * Five slots, since the third edition — down from seven cells. The month
	 * and the standing orders became one screen with a switch inside it, and
	 * the goal and the wealth are cards on Domů, whose detail screens keep
	 * Domů lit. The last slot is Nastavení itself (Q61): the Já hub that stood
	 * in front of it only repeated those two cards, and went. Anything under
	 * `/nastaveni` keeps the slot lit, which is how its five pages count.
	 *
	 * The disc in the middle is the record screen, which carries no bar of its
	 * own: the keypad owns the bottom of the phone there.
	 *
	 * A frosted pill floating over the page's bottom edge — the page scrolls
	 * under it. 62 px tall, 16 px in from each side, 24 px off the bottom (or
	 * clear of the home indicator), glass with the glass shadow. `.page` in
	 * `app.css` reserves the room (`--page-end`), so the last row still scrolls
	 * clear of it.
	 *
	 * The glass is liquid, not a pane. It bends what scrolls under it: an SVG
	 * displacement map — flat over the middle, turning outward at the rim —
	 * runs in the backdrop filter ahead of the blur, so the rim shows the
	 * content just outside it, compressed, the way a thick lens does. The
	 * rim catches the light from the top left and falls into shade at the
	 * bottom right; a highlight runs along the inside of the top edge; and
	 * the lens under the current tab — the same glass a step lighter, with a
	 * lit rim of its own — springs to whichever slot is chosen.
	 *
	 * The bend is Chromium's alone: WebKit and Gecko do not apply an SVG
	 * filter to a backdrop, and a declaration they half-understand could
	 * cost the blur, so the `url()` filter is only written where
	 * `navigator.userAgentData` exists — a Chromium engine, which is the one
	 * that renders it. Everywhere else the bar is frosted, rimmed and lensed
	 * without the bend.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from './Icon.svelte';

	/** The bend — how far, in px, the rim samples from outside itself. */
	const BEND = 32;

	const refracts = typeof navigator !== 'undefined' && 'userAgentData' in navigator;

	let bar = $state<HTMLElement | null>(null);
	let size = $state<{ w: number; h: number }>({ w: 0, h: 0 });

	$effect(() => {
		const el = bar;
		if (!el || !refracts) return;
		const ro = new ResizeObserver(([entry]) => {
			const { width, height } = entry!.contentRect;
			const w = Math.round(width + 2 * 8); /* border-box: the padding is 8 */
			const h = Math.round(height);
			if (w !== size.w || h !== size.h) size = { w, h };
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	/**
	 * The displacement map, drawn for the bar's exact size: red is the
	 * horizontal push, green the vertical, 128 is none. Zero along the pill's
	 * axis, rising as the cube of the distance to the rim, pointing outward —
	 * so the middle is a window and the rim is a lens.
	 */
	const lensMap = $derived.by(() => {
		const { w, h } = size;
		if (!w || !h) return null;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		const img = ctx.createImageData(w, h);
		const d = img.data;
		const r = h / 2;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const px = x + 0.5;
				const py = y + 0.5;
				/* The nearest point on the pill's axis, between the two cap centres. */
				const ax = Math.min(Math.max(px, r), w - r);
				const dx = px - ax;
				const dy = py - r;
				const dist = Math.hypot(dx, dy);
				const t = Math.min(1, dist / r);
				const bend = t * t * t;
				const nx = dist > 0 ? dx / dist : 0;
				const ny = dist > 0 ? dy / dist : 0;
				const i = (y * w + x) * 4;
				d[i] = 128 + nx * bend * 127;
				d[i + 1] = 128 + ny * bend * 127;
				d[i + 2] = 128;
				d[i + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return canvas.toDataURL();
	});

	type Destination = '/' | '/vypis' | '/prehled' | '/nastaveni';

	const tabs: { path: Destination; label: string; icon: IconName; also: string[] }[] = [
		{ path: '/', label: 'Domů', icon: 'home', also: ['/cil', '/jmeni'] },
		{ path: '/vypis', label: 'Výpis', icon: 'tape', also: ['/tape'] },
		{ path: '/prehled', label: 'Přehled', icon: 'month', also: ['/mesic', '/platby'] },
		{ path: '/nastaveni', label: 'Nastavení', icon: 'settings', also: [] }
	];

	const here = $derived(page.url.pathname.replace(/\/+$/, '') || '/');

	/** The slot the lens sits in — the disc takes the middle one. */
	const SLOT = [0, 1, 3, 4] as const;
	const lensSlot = $derived.by(() => {
		const i = tabs.findIndex((tab) => isCurrent(tab));
		return i === -1 ? null : SLOT[i]!;
	});

	function isCurrent(tab: (typeof tabs)[number]): boolean {
		const own = resolve(tab.path).replace(/\/+$/, '') || '/';
		if (here === own) return true;
		return tab.also.some((p) => {
			const path = resolve(p as '/').replace(/\/+$/, '') || '/';
			return here === path || here.startsWith(`${path}/`);
		});
	}
</script>

{#if lensMap}
	<svg class="filter" aria-hidden="true" focusable="false">
		<filter
			id="glass-refract"
			filterUnits="userSpaceOnUse"
			x="0"
			y="0"
			width={size.w}
			height={size.h}
			color-interpolation-filters="sRGB"
		>
			<feImage href={lensMap} x="0" y="0" width={size.w} height={size.h} result="map" />
			<feDisplacementMap
				in="SourceGraphic"
				in2="map"
				scale={BEND}
				xChannelSelector="R"
				yChannelSelector="G"
			/>
		</filter>
	</svg>
{/if}

<nav
	class="tabbar"
	class:tabbar--liquid={lensMap !== null}
	bind:this={bar}
	aria-label="Hlavní navigace"
>
	{#if lensSlot !== null}
		<span class="lens" style:--slot={lensSlot} aria-hidden="true"></span>
	{/if}

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
		bottom: var(--tabbar-lift);
		z-index: var(--z-nav);
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		align-items: center;
		height: var(--tabbar);
		padding: 0 var(--space-2);
		border-radius: var(--radius-full);
		background: var(--glass);
		box-shadow: var(--elev-glass);
		-webkit-backdrop-filter: blur(24px) saturate(1.6);
		backdrop-filter: blur(24px) saturate(1.6);
		isolation: isolate;
	}

	/* Liquid, on a Chromium engine only (see above): the bend runs ahead of a
	   light blur — a frost this thick would smear the bend to nothing — and
	   the fill thins a little so the bent content shows through it. */
	.tabbar--liquid {
		background: color-mix(in srgb, var(--glass) 82%, transparent);
		backdrop-filter: url(#glass-refract) blur(6px) saturate(1.8);
	}

	.filter {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	/* Without backdrop blur the glass has nothing to frost; go opaque. */
	@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.tabbar {
			background: var(--surface);
		}
	}

	/* The rim: a 1 px ring, lit from the top left. A gradient masked down to
	   the ring rather than a border, so it can change colour around the edge.
	   The lens wears the same ring, lit from straight above. */
	.tabbar::before,
	.lens::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		padding: 1px;
		border-radius: inherit;
		background: linear-gradient(
			135deg,
			var(--glass-shine) 0%,
			var(--glass-edge) 30%,
			var(--glass-rim) 65%,
			var(--glass-shine) 100%
		);
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		pointer-events: none;
	}

	/* The thickness: light entering along the top edge and dying out by the
	   middle of the pill. */
	.tabbar::after {
		content: '';
		position: absolute;
		inset: 1px;
		z-index: -1;
		border-radius: inherit;
		background: linear-gradient(180deg, var(--glass-shine) -40%, transparent 55%);
		opacity: 0.45;
		pointer-events: none;
	}

	/* The lens under the current tab: one of five equal slots inside the
	   padding, a step lighter than the glass, springing to the chosen one —
	   past it and back, the way liquid settles. */
	.lens {
		position: absolute;
		top: 6px;
		bottom: 6px;
		left: calc(var(--space-2) + var(--slot) * ((100% - 2 * var(--space-2)) / 5));
		z-index: -1;
		width: calc((100% - 2 * var(--space-2)) / 5);
		border-radius: var(--radius-full);
		background: var(--glass-lens);
		transition: left var(--dur-slow) var(--ease-spring);
	}

	.lens::before {
		background: linear-gradient(
			180deg,
			var(--glass-shine) 0%,
			var(--glass-edge) 45%,
			var(--glass-rim) 100%
		);
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
