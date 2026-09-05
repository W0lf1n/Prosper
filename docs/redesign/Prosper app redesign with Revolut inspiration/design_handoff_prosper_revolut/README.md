# Handoff: Prosper — Revolut-inspired redesign

## Overview

A full visual and structural redesign of Prosper (SvelteKit 2 / Svelte 5 PWA, Czech UI, Dexie, 150 kB brotli budget). The current "graphite instrument" design — true-black, keypad-first, four-tab bar — is replaced by a Revolut-style consumer-banking layout: soft-grey ground with white cards (dark counterpart: black ground with `#16181a` cards), one proportional sans, pill buttons and chips, circular category icons, a five-slot tab bar with a central record disc, and a home screen that leads with the month's net figure.

Flow, domain logic, checks, sync and the data layer do **not** change. This is a new UI on top of the existing `lib/domain`, `lib/db` and `lib/sync`.

## About the design files

`Prosper Revolut.dc.html` (+ `support.js`, `ios-frame.jsx`) is a **design reference written as HTML** — a clickable prototype inside an iPhone frame showing the intended look and behaviour. It is not production code. Recreate it in the app's own environment: Svelte 5 runes, scoped CSS in `.svelte` files, tokens in `lib/styles/tokens.css`, icons in `lib/ui/Icon.svelte`. Open the prototype directly in a browser (needs the sibling `support.js` and `ios-frame.jsx`; fonts and the icon library load from CDN).

## Fidelity

**High fidelity.** Colours, sizes, weights, radii, spacing and copy are final. Not specified pixel-exactly: scroll positions, the iPhone bezel (a presentation frame only), and sample data (figures are illustrative; the app renders live ledger data).

## Route map (changes)

| Old route | New | Notes |
| --- | --- | --- |
| `/` keypad | `/` **Domů** (home) | The keypad moves to `/zapis`, opened from the tab-bar `+` disc and the "Zapsat" pill |
| — | `/zapis` **Zápis** | Full-screen record flow, no tab bar, `✕` returns to previous screen |
| `/tape` | `/tape` **Výpis** | Same content, new list grammar |
| `/mesic`, `/platby` | `/prehled` **Přehled** | One route, pill tabs "Měsíc \| Platby" under the title; month switcher in the title row |
| `/cil`, `/jmeni`, `/nastaveni` | `/ja` **Já** | Hub with a Cíl card, a Jmění card and a Nastavení list; the three original routes stay as detail screens with a back chevron and "Já" active in the tab bar |

Tab bar: **Domů · Výpis · ⊕ · Přehled · Já**.

## Design tokens

Add these as new values in `tokens.css` (keep the existing token names — remap values). Light is now the default theme; dark is the explicit choice / `prefers-color-scheme: dark`.

### Colours

| Role | Light | Dark |
| --- | --- | --- |
| ground `--ground` | `#f4f4f4` | `#000000` |
| card `--surface` | `#ffffff` | `#16181a` |
| soft (chips, tracks, secondary pills) `--surface-3` | `#f0f0f2` | `rgba(255,255,255,.08)` |
| well (recessed slab, e.g. goal "why") `--ground-2` | `#f4f4f4` | `#0a0a0a` |
| ink `--ink` | `#191c1f` | `#ffffff` |
| mute `--ink-2` | `#505a63` | `rgba(255,255,255,.72)` |
| stone `--ink-3` | `#8d969e` | `rgba(255,255,255,.5)` |
| hairline `--hairline` | `#e2e2e7` | `rgba(255,255,255,.12)` |
| primary pill bg / label | `#191c1f` / `#ffffff` | `#ffffff` / `#000000` |
| accent (record disc, links, avatar, goal meter) `--signal` | `#494fdf` | `#494fdf` |
| in (money in, met goal, positive) `--in` | `#00a87e` | `#19c48f` |
| flag / warn `--flag` | `#ec7e00` | `#ec7e00` |
| danger `--danger` | `#e23b4a` | `#e23b4a` |

Category palette (user-pickable, also default per seeded bucket): teal `#00a87e` (POTRAVINY, PŘÍJEM), orange `#ec7e00` (JÍDLO), light-blue `#007bc2` (BYDLENÍ), pink `#e61e49` (LIFESTYLE), yellow `#b09000` (INVESTICE DO MĚ), cobalt `#494fdf` (DARY), green `#428619` (SPOŘENÍ), brown `#936d62` (PROJEKTY), stone `#8d969e` (OSTATNÍ), red `#e23b4a`.

Split classes in the 10/10/10/70 ring: dávání `#494fdf`, spoření `#428619`, dluhy `#936d62`, život `#8d969e`, track = soft.

No shadows on resting surfaces. Shadow only on the bottom sheet (`0 -12px 48px rgba(0,0,0,.25)`) and the toast (`0 12px 32px rgba(0,0,0,.18)`).

### Type

One family: **Inter** (400 / 500 / 600), `font-variant-numeric: tabular-nums` on the app root. IBM Plex Mono is retired; the mono `.money` class becomes Inter 600 tabular. Body letter-spacing `.1px`; small labels `.24px`.

| Role | Size / weight / tracking |
| --- | --- |
| Home hero figure | 44 / 600 / −1.3px, line-height 1 |
| Record amount | 56 / 600 / −1.8px |
| Screen title (Výpis, Přehled) | 28 / 600 / −.5px |
| Big figure in cards (balance, Za rok, goal total, Jmění total on Já) | 34 / 600 / −.8px (Jmění hero 40 / −1.2px) |
| Card figure | 22 / 600 / −.4px |
| Row title | 15 / 600 |
| Body | 15 / 400 |
| Row sub / hints | 13 / 400, colour mute |
| Card label (section header) | 13 / 400 / .24px, colour mute — sentence case, **no uppercase** |
| Tab label | 11 / 600 |
| Small pill/badge | 12–13 / 600 |

### Shape & space

- Cards `border-radius: 20px`, padding 16. Inputs / date pill / check strip / icon-grid cells 12px. Bottom sheet 28px top corners. Account card 16px.
- **Every button is a pill (9999px)** — primary, soft, small. The "pill is reserved for the primary action" rule is dropped.
- Circles: category icon 40px (list rows), 34px (settings), 28px (inside record chips), 52px (record disc, sheet preview).
- Page gutter 16px; card gap 12px; row min-height 60–64 (list), 52 (settings rows), 48 (categories).
- Touch: primary pills 48px, secondary 40px, keypad keys 56px, tab cells ≥44px.

### Motion

Press: background luminance only (no scale). Toast: fade+rise 220ms `cubic-bezier(.16,1,.3,1)`, auto-dismiss 2.6s. Toggle knob 150ms. Category-chip rail and account rail are native horizontal scroll (`scroll-snap-type: x mandatory` on the account rail).

## Screens

### Domů (`/`)

Scrolling column, padding `62 16 120`.
1. **Header row** (48px): avatar 36px circle accent with initials, "Srpen 2026" mute 15px; right: 40px round card-coloured button with the sliders icon → `/nastaveni`.
2. **Hero** (centered): label "Zůstatek měsíce" 13 mute; net figure 44/600 signed ("+4 015,50 Kč"); two pills below on card bg, 13/600: "↑ 59 400,00" in colour `--in`, "↓ 55 384,50" in mute.
3. **Action row**: three equal pills 48px — "Zapsat" (primary), "Výpis", "Měsíc" (card bg).
4. **K potvrzení card** (only when a `confirm` schedule is due): label + 8px warn dot; row: category circle 40, "Internet" 600 / "BYDLENÍ · 15. srpna" 13 mute, amount right "−640,00 Kč" 600; two 40px pills "Potvrdit" (primary) / "Přeskočit" (soft). Confirm writes the txn and toasts; skip hides the card and toasts `„Internet" tenhle měsíc přeskočeno`.
5. **Cíl card** (tappable → `/cil`): label "Cíl · {name}" + badge "měsíc splněn" (12/600, `--in` on `rgba(0,168,126,.12)`, pill); "5 000,00 Kč" 22/600 with "z 5 000,00 Kč tento měsíc" 13 mute right; 6px meter, track soft, fill `--in` (fill colour follows pace: `--in` met, accent on track, warn behind).
6. **Jmění card** (→ `/jmeni`): label "Jmění celkem", 22/600 total, 13 mute "Na účtu … · V investicích …", chevron right in stone.
7. **Poslední záznamy card**: header row (label + "Zobrazit vše" accent 13/600 → `/tape`), last 3 rows in the list-row grammar (below). Rows from all accounts, amount in the account's currency.

### Zápis (`/zapis`) — fixed layout, no scroll, no tab bar

Padding `56 16 44`, flex column; the amount block is `flex:1`.
1. **Header**: 40px round ✕ (card bg) left; center segmented pill (card bg, 3px padding): "Výdaj" / "Příjem", 34px, active = primary pill colours; switching direction clears the category (Příjem preselects PŘÍJEM).
2. **Account rail**: horizontal snap rail, cards `calc(100% − 40px)` wide × 64px, radius 16, card bg: 36px circle in the account colour with the currency symbol, name 14/600 + code 12 mute, balance right 14/600. Dots row (6px) below, active = ink. Swipe or tap a card to select; the selected account is the one the row is written to and defines the currency (Q49 semantics unchanged).
3. **Amount**: label "Výdaj"/"Příjem" 13 mute; digits 56/600 (`--in` when Příjem); **currency button** beside it — pill on card bg, 20/500 mute, symbol + small chevron-down — tapping cycles to the next account and scrolls the rail.
4. **Category rail**: horizontal scroll of pills 40px (`padding 0 14 0 6`): 28px category circle with icon + name 13/600. Selected = primary pill colours. Order by usage ranking, as today.
5. **Meta row**: date pill 48px "dnes" (card bg, radius 12) + payee input (card bg, radius 12, 48px, placeholder "komu / za co").
6. **Props row** (Výdaj only, 44px): toggle 40×24 (track hairline → accent, white knob) + "mimořádný výdaj" 14 mute; right "dluží mi ›" 14 mute.
7. **Check strip** (when a finding exists): card bg, radius 12, 8px warn dot, title 14/600, right: small primary pill with the fix label ("JÍDLO", "Označit"). Same `checkDraft` findings as today; the prototype implements `misfiled` and `one-off` (≥ 5 000).
8. **Keypad**: 3-column grid, gap 4, keys 56px, transparent, 26/500; active state = card bg. Keys 1–9, `,`, 0, ⌫.
9. **Uložit**: 52px primary pill; opacity .4 when not savable; label "Vyber kategorii" when amount is set but no bucket.
On save: navigate to Domů, toast "−410,00 Kč · JÍDLO · Restaurace" (primary pill colours, 14/600, centered, 112px above bottom).

### Výpis (`/tape`)

1. Title "Výpis" 28/600.
2. **Balance card**: label "Běžný účet"; 34/600 balance; "aktuální zůstatek" 13 mute; hairline; row "Srovnat s bankou" (accent 600) … "zatím nikdy ›" (mute 14) → ReconcileSheet.
3. **Month row**: "Srpen 2026" 17/600 left; two small pills right (12/600, card bg): "↓ 55 384,50" mute, "↑ 59 400,00" `--in`. Collapsible per month as today.
4. **Day groups**: outside the card a label row — day name 13 mute ("Dnes", "Včera", "st 26. srpna") and the day's net 13 mute right; then a card (padding `4 16`) with rows. A day with nothing on it renders one 52px row: 40px soft circle with a teal check + "bez výdaje" 15 mute.
5. **List row** (64px): 40px circle in the category colour with the category icon (white, 18px); payee 15/600 (falls back to category name), category 13 mute; right column: amount 15/600 signed (`--in` when positive), running balance 12 stone.

### Přehled (`/prehled`)

Title row: "Přehled" 28/600; right a pill switcher (card bg): 36px round chevrons, "srpen 2026" 14/600. Below: full-width segmented pill "Měsíc | Platby" (38px, active = card bg on soft track… in the prototype the track is card bg and the active segment inverts; either is acceptable, keep one).

**Měsíc**
- Totals card: label, net 34/600 in `--in`; two soft tiles (radius 12) "Přišlo" / "Odešlo" (12 mute + 15/600); aside sentence with bold figures.
- Dny bez výdaje card: 92px ring (stroke 12, track soft, fill `--in`), "9 z 28 dní" (22/600 + 15 mute), streak line 13/600 `--in`.
- Kontrola card: label; findings separated by hairlines: 8px dot (warn / stone), title 15/600, detail 13 mute; a fix renders as a 32px soft pill ("Přepsat hodnotu" → `/jmeni`).
- Rozdělení příjmu card: 120px ring (stroke 14) with "7 % / zbylo" centered; legend rows 14 with 10px dots, percentage 600, delta 12 (danger / warn / stone); verdict sentence 14 mute.
- Kam to šlo card: per bucket — 40px icon circle, name + total 14/600, 5px meter in the category colour, footer 12 mute (share left, trend/one-off note right).

**Platby**
- K potvrzení card (same as home).
- Za rok card: 34/600 yearly; facts rows 14 with hairlines ("Odejde za měsíc", "Ještě odejde tenhle měsíc").
- Odchází card: rows 64px — icon circle, payee 600 + "15. · BYDLENÍ" 13 mute, amount 600 + mode badge 11/600 soft pill ("automaticky" / "potvrdit"); "Přidat platbu" 48px soft pill.
- Přichází card: hint copy + "Přidat příjem" 40px soft pill.

### Já (`/ja`)

Header: 56px accent avatar with initials, name 22/600, "Běžný účet · CZK" 13 mute.
- Cíl card (→ `/cil`): label + chevron; name 20/600; "41 000,00 Kč" 600 / "z 150 000,00 Kč · 27 %" 13 mute; 6px accent meter.
- Jmění card (→ `/jmeni`): label + chevron; 22/600 total; "1 hodnota je stará" 13/600 warn when a valuation is stale.
- Nastavení card: label; rows 52px with hairlines: name 15, detail 13 mute, chevron — Účty, Kategorie, Vzhled, Synchronizace, Data → `/nastaveni`.

### Cíl (`/cil`) — detail

Back header (40px round chevron, "Cíl" 17/600).
- Goal card: name 22/600 + "na očích" pill (eye icon, 12/600, soft); **why** in a recessed slab (`--ground-2`, radius 12, italic 16/1.5); "41 000,00 Kč" 34/600 with "z 150 000,00 Kč" 14 mute **on its own line beneath**; 8px accent meter; footer "27 %" (600) … "do 30. června 2027 · 10 měsíců" 13 mute.
- Month card: label "Srpen 2026"; 22/600 + "z …" 14 mute; 8px `--in` meter; pace line 14/600 `--in`; pills "Odložit" (primary) / "Upravit cíl měsíce" (soft), 48px.
- Měsíce card: rows 52px — month 15, saved 600, "/ target" 13 mute (84px right-aligned), 24px mark circle (`--in` ✓ / danger ✕).
- Footer actions right-aligned: "Upravit cíl" (card-bg pill 40px), "Smazat" (text, danger).

### Jmění (`/jmeni`) — detail

Back header. Centered hero: "Celkem" 13 mute, 40/600 total, warn line "• investice k 30. dubna" 12/600 when a reading is stale. Two half-width cards "Na účtu" / "V investicích" (12 mute + 16/600). Reminder card (warn dot, title 600, detail, primary 36px pill "Přepsat hodnotu" → ValuationSheet). Holdings card: rows 72px — 40px circle in the holding colour with a short code, name 600 + "k 26. srpna · vloženo 118 000" 13 mute (warn 600 when stale), value 600 + change 12/600 `--in`. "Přidat investici" 48px card-bg pill. Footnote 13 mute.

### Nastavení (`/nastaveni`) — detail

Back header. Cards: **Účty** (account row with 40px accent circle, name, "běžný · zapisuje se sem", balance; pills "Přidat účet" / "Upravit"), **Kategorie** (rows 52px: 34px icon circle, name 15, type badge, chevron — **tap opens the category editor sheet**; hint "Ťukni na kategorii a vyber jí ikonu a barvu."; "Nová kategorie" pill), **Vzhled** (3-segment pill on soft track: systém / světlý / tmavý; active = card bg), **Synchronizace** (copy + "Spárovat" primary 44px), **Data** (three soft pills, facts rows, "Začít znovu" as a 48px pill outlined 1.5px danger, danger text).

### Category editor (bottom sheet)

Overlay `rgba(0,0,0,.45)`; sheet card bg, 28px top radius, padding `10 16 44`, grip 36×4 hairline. Preview: 52px circle in the chosen colour with the chosen icon 24px + name 17/600 + "Ikona a barva kategorie". "Barva": 36px swatches from the category palette, selected = ring `0 0 0 2px card, 0 0 0 4px ink`. "Ikona": 8-column grid of 40px cells radius 12, soft bg, selected = primary pill colours. "Hotovo" primary 48px. Changes apply live everywhere the category appears.

**Data model change:** `Category` gains `icon: string` (icon name) and `color: string` (hex from the palette). Seed defaults: potraviny `shopping-cart`, jídlo `utensils`, bydlení `house`, lifestyle `sparkles`, investice do mě `graduation-cap`, dary `gift`, spoření `piggy-bank`, projekty `hammer`, ostatní `ellipsis`, příjem `banknote`. New migration (v12); `updateCategory` accepts both fields.

## Icons

The prototype uses **Lucide** (ISC licence). In the app, do **not** load it from a CDN (offline promise, bundle budget): copy the chosen subset of SVG paths into `Icon.svelte` (stroke 2, round caps, 24 grid). Offered set in the editor: shopping-cart, utensils, coffee, house, zap, wifi, car, bus, fuel, sparkles, shirt, gift, heart, piggy-bank, wallet, banknote, graduation-cap, book-open, dumbbell, stethoscope, pill, hammer, wrench, laptop, smartphone, plane, film, music, dog, baby, ellipsis, tag (≈ 32 icons, well under 10 kB). Tab-bar and chrome glyphs keep the existing set (tape, month ring, settings sliders, chevrons, check, close, eye, plus) plus two new ones drawn in the same grammar: house (Domů) and person (Já).

## State

New UI state only: `screen`/route, `prehledTab` ('mesic' | 'platby'), `accountIdx` on Zápis (selected account, synced to the rail's scroll position; restored when the screen is re-entered), category editor `editCat`, toast. Theme: `system | light | dark` stored as today; **light is the new default**. Everything else reads the existing live queries.

## Assets

- Fonts: Inter (self-host 400/500/600 latin + latin-ext woff2; the Plex Mono files can be removed).
- Brand mark: unchanged (`docs/brand/*.svg`), used on the splash; the header avatar shows user initials in the accent circle.
- `ios-frame.jsx` in this bundle is the presentation bezel only — not part of the app.

## Files

- `Prosper Revolut.dc.html` — the clickable prototype (all screens, both themes via the `theme` prop / Vzhled segment)
- `support.js` — runtime the prototype needs to open in a browser
- `ios-frame.jsx` — iPhone frame used by the prototype
- `assets/` — Prosper brand marks copied from the repo
