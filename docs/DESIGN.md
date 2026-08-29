# Design — graphite instrument

The app's design system, now in its **second edition** — same instrument,
calmer machining. It is not a theme layered over the app: every colour, size
and radius is a token in `apps/web/src/lib/styles/tokens.css`, and the four
rules below are enforced by grep as much as by taste.

This document is the system as it stands. The second edition as it was
delivered — tokens, four patches, previews — is
[`design_handoff_prosper_visual_refresh/`](design_handoff_prosper_visual_refresh/),
and the reasoning behind each move is in [`DECISIONS.md`](DECISIONS.md) under
the two design passes.

---

## The screens

<table>
<tr>
<td width="33%" valign="top">
<img src="screens/entry-light.png" alt="Entry screen in the light theme">
<p align="center"><b>Entry</b><br><sub>The launch route, and the only one that never scrolls. Month standing on top, then the amount in a pool of light, three most-used buckets, keypad. Three actions to a saved row.</sub></p>
</td>
<td width="33%" valign="top">
<img src="screens/tape-dark.png" alt="The ledger tape">
<p align="center"><b>Výpis — the tape</b><br><sub>Reverse-chronological, running balance per row, days separated by score lines, days that cost nothing recessed and marked <i>bez výdaje</i>.</sub></p>
</td>
<td width="33%" valign="top">
<img src="screens/split-dark.png" alt="The 10/10/10/70 split as two rings">
<p align="center"><b>The split</b><br><sub>10 / 10 / 10 / 70 measured against <i>income</i>, not outflow — so overspending shows as a negative remainder instead of summing to a tidy 100 %. Shown on a month that overran, because that is the only time it can say so.</sub></p>
</td>
</tr>
<tr>
<td width="33%" valign="top">
<img src="screens/goal-dark.png" alt="The goal screen">
<p align="center"><b>Cíl — the goal</b><br><sub>The why in your own words, before any number. Then this month's figure, marked <i>committed</i> or merely <i>proposed</i>. Then the record of months.</sub></p>
</td>
<td width="33%" valign="top">
<img src="screens/wealth-dark.png" alt="Holdings and the total">
<p align="center"><b>Jmění — what it adds up to</b><br><sub>Hand-typed holding values with the day each was true. No tickers, no price feed. A reading that has gone stale raises an amber strip inside its own card. Growth is never counted as income.</sub></p>
</td>
<td width="33%" valign="top">
<img src="screens/schedules-dark.png" alt="Recurring payments in settings">
<p align="center"><b>Recurring payments</b><br><sub>Declared, not detected. Each one posts automatically or waits for one tap, with the annual cost stated where you set it.</sub></p>
</td>
</tr>
</table>

Both themes are first-class. Dark is the one it was designed for — this is an
app used one-handed, in bed, with the lights off, and its ground is true black
for exactly that reason.

---

## The four rules

**1 · Elevation is luminance, not shadow.** A card is raised because it is
lighter than the ground, not because it throws one. Real shadow survives in
exactly two places, both of which genuinely float over content — the sheet and
the toast. Cards, buttons, the keypad shell and the tab bar all gave theirs up.

**2 · Recession is a pocket.** There is not one `inset` shadow in the app.
Inside a card, recessed is `--ground-2` and raised is `--raised`, and it steps
the right way in both themes: `#0c0c0e → #2a2a2c` dark, `#e8e8ec → #ffffff`
light. Meter tracks, field inputs, the goal's _why_ slab and the ledger's gap
days are all that same pocket.

**3 · One press, one number.** Every button presses with `scale(0.95)` over
90 ms and nothing else moves. The one exception is a full-bleed list row, which
presses by background luminance instead — scaling a 100 %-wide row by 5 % shows
the ground through its own corners.

**4 · Pill is reserved for the primary action.** `--radius-full` on a button
means "this is _the_ action". Two buttons of equal size are told apart by shape,
not by a second colour.

---

## Colour

**One chrome accent, and it is blue.** `--signal` is links, primary buttons, the
focus ring, the current selection and the record disc. It is never decoration
and it is never a data colour.

**Money going out has no hue at all.** `--out` is the ink. A ledger is mostly
outflow, and forty red numbers is noise rather than information — so the only
coloured number on a ledger screen is an inflow.

Data colour is the single exemption: mint for money in, amber for _look at
this_, coral for _destroy or refuse_, and four hues for the classes of the
split. All of them sit near the same lightness and chroma per theme, so no class
shouts over another, and none of them is ever re-tuned alone.

| Role                 | Dark (primary)                            | Light                                     |
| -------------------- | ----------------------------------------- | ----------------------------------------- |
| Ground → surfaces    | `#000000` → `#1d1d1f` `#252527` `#2a2a2c` | `#f5f5f7` → `#ffffff` `#fafafc` `#f2f2f5` |
| Ink                  | `#f5f5f7`                                 | `#1d1d1f`                                 |
| Signal — chrome only | `#409cff`                                 | `#0066cc`                                 |
| In · flag · danger   | `#4ccfa1` · `#dfb567` · `#ef6f5e`         | `#007850` · `#8a6400` · `#c93f32`         |

Hairlines are ink at 9 % and 16 %, never a painted grey, so they sit correctly
on every surface instead of being tuned to one. Two greps have to come back
empty: **a literal hex outside `tokens.css`**, and **`font-weight: 500`** — the
ladder is 400 / 600 / 700 and the middle weight does not exist here.

---

## Type

**The app ships one typeface, and it ships it for money.** Every amount is IBM
Plex Mono, tabular, right-aligned, always, so two figures in a column can be
compared without being read. That is functional first and the visual identity
second. Four woff2 files, latin + latin-ext, 57 kB self-hosted — a font CDN
would break the offline promise.

Everything that is not money is the system stack, which resolves to real SF Pro
on Apple hardware and costs nothing at all. Instrument Sans left with the second
edition, which is how a whole visual refresh landed **under** the bundle it
started from.

---

## The mark

<div align="center">
<img src="brand/icon-p-light.svg" width="96" alt="Prosper mark, light">
<img src="brand/icon-p.svg" width="96" alt="Prosper mark, dark">
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<img src="brand/icon-light.svg" width="96" alt="Prosper ring, light">
<img src="brand/icon.svg" width="96" alt="Prosper ring, dark">
</div>

The **P** is the app logo, cut for each theme. Its bowl is not a letterform
decision — it is the 10/10/10/70 ring, drawn to the number: three arcs of a
tenth each in signal, in and flag, then seven tenths of ink, which is the
living share. The gap between segments is taken out of the share it follows,
so the four still sum to the whole circle. The stem is the only thing added to
make it read as a letter, and it is what the ring is clipped against.

The P is also the **app icon** — the favicon, the apple-touch icon and every
manifest PNG are rasterised from the dark cut, since an icon sits on the
true-black ground of the installed app. The maskable cut scales the mark to
90 % so the stem's foot clears a round mask's safe zone. It is the first thing
seen on launch too: the splash in `app.html` opens on the mark alone, the bowl
gives way to a set letter, and the rest of the name arrives letter by letter —
with the ring taking the **o** — until the lockup stands. The sequence plays
out in full on every launch, about a second, by Petr's explicit choice: the
app renders and gets ready underneath it, only the reveal waits. Under reduced
motion there is no sequence, so the still lockup leaves as soon as the app is
up.

The **ring alone** is the same geometry with the stem taken off. It earned its
use in the wordmark: it is the **o** of Prosper, in the lockup and at the end
of the launch animation.

Six files — a light and a dark cut of each, plus a `currentColor` cut of each
that takes the colour of whatever it is placed in. All of them are stroked
arcs on one circle, expressed as `stroke-dasharray` against the circumference,
so the split is legible in the source rather than baked into path data. Under
a kilobyte apiece, and nothing to rasterise.
