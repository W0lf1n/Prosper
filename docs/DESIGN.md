# Design — third edition

The app's design system, in its **third edition** since 2026-09-05: a
consumer-banking layout in the manner of Revolut. It replaced the "graphite
instrument" of the first two editions — the true-black ground, the grain, the
ambient pool behind the amount, the monospace money — with a soft-grey ground,
white cards, one proportional sans, pills and circles.

It arrived as a high-fidelity handoff and was applied as specified. The handoff
— a clickable prototype and a README with every token, size and screen — is
[`redesign/Prosper app redesign with Revolut inspiration/design_handoff_prosper_revolut/`](redesign/);
the reasoning behind each move, and every deviation from it, is in
[`DECISIONS.md`](DECISIONS.md) under the third edition. Every value lives in
`apps/web/src/lib/styles/tokens.css`, and the rules below are enforced by grep
as much as by taste.

The screenshots in `screens/` predate this edition and are kept as a record of
earlier passes — trust the code and `tokens.css` over them.

---

## The screens

**Domů** leads with the month's net at 44 px, two pills for what came in and
went out, and three actions — Zapsat, Výpis, Měsíc. Under them, cards: what the
standing orders are waiting on, the goal's month, the wealth total, the last
three rows. **Zápis** is full-screen: the direction as a segmented pill, the
account rail, the amount at 56 px with the currency as text beside it, the
bucket rail, the date and the payee, the keypad, Uložit. **Výpis** is a balance
card, then a card per day. **Přehled** is Měsíc and Platby behind one segmented
pill, with the month switcher in the title row. **Já** is a title and three
cards — Cíl, Jmění, Nastavení — each opening a detail screen with a back
chevron. The tab bar floats over every one of these as a frosted pill, and the
page ends far enough under it for the last row to scroll clear.

The bar is five slots: Domů · Výpis · ⊕ · Přehled · Já. The disc opens Zápis,
which carries no bar of its own.

---

## The four rules

**1 · Elevation is luminance, and only luminance.** A card is white on the
ground and raised by nothing else — no hairline, no lit edge, no shadow. The two
layers that genuinely float, the sheet and the toast, are the only shadows in
the app.

**2 · Every button is a pill.** Primary 48 px, secondary 40, small 32. Rank is
fill, not shape: the primary pill inverts with the theme (ink on white by day,
white on black by night), a soft pill sits inside a card, a card-coloured pill
sits on the ground, quiet is text, danger is a 1.5 px outline. The old rule that
reserved the pill for the primary action is gone with the second edition.

**3 · Press is luminance.** A pill or a row darkens one step under the thumb.
Nothing scales, nothing glows.

**4 · Identity is a circle.** A bucket, an account, a holding — its colour
behind a white glyph or a short code: 40 px in a list row, 34 in Settings, 28
inside a chip, 52 on a preview. A category's colour and icon are the person's
to pick, from ten hues and thirty-two icons, and they apply live everywhere the
bucket appears.

---

## Colour

**One accent, and it is cobalt.** `--signal` is the record disc, links, the
goal's meter, a toggle that is on. It is never decoration and never
a data colour — with one exception it shares its hue with: the category palette,
which the person picks, and which contains the same cobalt under its own name.

**The primary pill is the other chrome.** Ink on the light theme, white on the
dark one — two tokens, `--pill` and `--pill-ink`, because a pill inverts between
themes and nothing else does.

**Money going out has no hue at all.** `--out` is the ink. A ledger is mostly
outflow, and forty red numbers is noise rather than information — so the only
coloured amount on a ledger screen is an inflow, in mint.

Data colour is the single exemption: mint for money in and a verdict that came
out right, amber for _look at this_, red for _destroy or refuse_, and the
category palette — ten hues, theme-independent, because a bucket's colour is a
name and a name does not change with the lights. The four split classes borrow
four of them. The denominator of every meter and ring is the soft surface.

| Role                 | Light (default)                          | Dark                                          |
| -------------------- | ---------------------------------------- | --------------------------------------------- |
| Ground → card → soft | `#f4f4f4` → `#ffffff` → `#f0f0f2`        | `#000000` → `#16181a` → white at 8 %          |
| Ink · mute · stone   | `#191c1f` · `#505a63` · `#8d969e`        | `#ffffff` · white at 72 % · white at 50 %     |
| Pill                 | `#191c1f` on `#ffffff`                   | `#ffffff` on `#000000`                        |
| Signal               | `#494fdf`                                | `#494fdf`                                     |
| In · flag · danger   | `#00a87e` · `#ec7e00` · `#e23b4a`        | `#19c48f` · `#ec7e00` · `#e23b4a`             |

Three greps have to come back empty: **a literal hex outside `tokens.css`**,
**`font-weight: 700`** — the ladder is 400 / 500 / 600 — and
**`text-transform: uppercase`** — every label is sentence case. The one colour
written twice is the ground, in `app.html`'s `theme-color` and in the manifest,
neither of which can take a custom property.

---

## Type

**One family: Inter**, self-hosted as a variable face — latin and latin-ext,
400 to 600, two files and 133 kB — because a font CDN would break the offline
promise. IBM Plex Mono left with this edition; money is Inter 600 with tabular
figures, and the whole app is set `font-variant-numeric: tabular-nums` so a
column of amounts still lines up without a monospace face.

The weight 500 lives in exactly two places: the keypad's digits and the
currency beside the amount. Sizes are fixed, not fluid — 11 for tab
labels, 13 for card labels and row subs, 15 for body and row titles, 22 for a
card figure, 28 for a screen title, 34 for a big figure, 40 for the Jmění hero,
44 for the home hero, 56 for the amount being typed — and the large ones tighten
as they grow, from −0.4 px at 22 to −1.8 px at 56.

---

## Shape, space and motion

Cards have 20 px corners and 16 px of padding; inputs, cells and the check strip
12 px; the account card 16; the sheet 28 at the top. The page gutter is 16, the
gap between cards 12, a list row 60–64 px tall, a settings row 52, a bucket
chip 40. Touch: primary pills 48, secondary 40, keypad keys 56, tab cells at
least 44.

The toast is a pill in the primary colours, centred above the bar, fading and
rising in 220 ms and staying 2.6 s — six with Zpět on it. The toggle's knob
moves in 150 ms. The account rail and the category rail are native horizontal
scroll; the account rail snaps one card at a time. Nothing else animates, and
`prefers-reduced-motion` turns even that off.

**A sheet has no close button.** It is pulled down by its grip, dismissed by
tapping the dimmed app behind it, or by Esc. A sheet that commits something
carries its own primary pill, and that pill closes it on the way out.

---

## The mark

<div align="center">
<img src="brand/icon-p-light.svg" width="96" alt="Prosper mark, light">
<img src="brand/icon-p.svg" width="96" alt="Prosper mark, dark">
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<img src="brand/icon-light.svg" width="96" alt="Prosper ring, light">
<img src="brand/icon.svg" width="96" alt="Prosper ring, dark">
</div>

The **P** is the app logo, cut for each theme, and unchanged by this edition.
Its bowl is the 10/10/10/70 ring, drawn to the number: three arcs of a tenth
each in signal, in and flag, then seven tenths of ink, the living share. The
stem is what makes it read as a letter, and what the ring is clipped against.

The P is also the **app icon** — the favicon, the apple-touch icon and every
manifest PNG — and the first thing seen on launch: the splash in `app.html`
opens on the mark alone and the rest of the name arrives letter by letter, the
ring taking the **o**. It plays out in full on every launch, by Petr's choice.
Under reduced motion there is no sequence.

Inside the app the mark does not appear, and there is no avatar either: the app
is one person's, and a header that says who is holding the phone says nothing.
