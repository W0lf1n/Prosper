# Charts — the design plan

**Status:** plan, with four of its charts built and on Domů for everybody
(2026-10-18, `DECISIONS.md` Q92–Q95), arranged in Nastavení › Domů. The split
meters replaced the ring on Přehled too (Q94).
**Audience:** Petr (decisions), Claude Code (implementation)
**Reads with:** `DESIGN.md` (the system), `PROJECT-PLAN.md` §2 (the laws),
`domain/charts.ts` and `domain/prosperity.ts` (the arithmetic)

> Asked for: (a) a heatmap of the month's spending, (b) a financial-wellbeing
> chart people can actually read — the 10/10/10/70 ring is not used because it
> cannot be read — (c) a progress chart over a day, a week, a month, a year
> and everything, and (d) any other chart that is widely used and proven to
> help people keep or grow their money.

---

## 0. The rules every chart here keeps

These are not taste. Each is a rule the rest of the app already keeps, and a
chart that broke one would disagree with the screen next to it.

1. **A chart serves a law, or it is not built** (`CLAUDE.md`). Each section
   below names its law. A chart that only decorates is a chart that becomes
   wallpaper, and `TODO.md` §5 already watches for wallpaper.
2. **The arithmetic lives in `domain/`, tested; a component only draws.** No
   chart computes a sum. Spending is `checks.ts` → `spendingRows` — the same
   rows the month slab and Přehled count — so no chart can disagree with them.
3. **One currency per chart, never summed across** (Q49). A chart reads the
   active account's currency, every account in it (Q83). Moves between his own
   accounts are never spending.
4. **Money out has no hue.** Out is ink; in is mint; a verdict that came out
   right is mint; _look at this_ is amber. Blue is the accent for controls and
   the goal meter, not for data (the 2026-08-29 audit). Colours come from
   `tokens.css` and nowhere else — the heatmap's four steps are tokens
   (`--heat-1` … `--heat-4`, light and dark each named once).
5. **The sentence first, the plot second.** Every chart leads with one line
   in Czech that says what it shows — "O 2 300 Kč méně než minulý měsíc ke
   stejnému dni" — and the plot is the evidence under it. Somebody who reads
   only the sentence has still been told the thing.
6. **Hand-rolled SVG, no library** (rule 12). Every chart here is one path or
   one grid; a charting package would be the second runtime dependency for
   shapes the browser draws natively.
7. **The marks are quiet.** 2 px lines with round caps, an end dot of 8 px with
   a 2 px ring in the card's colour, solid hairlines for baselines and
   crosshairs — never dashed (a dashed line reads as a forecast), a wash of
   ink under an area. No gridlines, no y axis: the figure on top is the value.
8. **Touch is the hover.** A finger on a line moves a crosshair and the figure
   on top follows it; a tap on a cell says its value under the grid. Every
   value a gesture reveals is also said somewhere without one. Line charts are
   keyboard sliders (arrow keys), cells are buttons with labels.
9. **Two series get a legend; one does not.** A legend is a line-key and a
   word, under the plot. The card's label already names a single series.

---

## (a) Kalendář útraty — the month as a heatmap · **built**

**Law:** Tracking (the days are the record, and a day with nothing spent is a
day nothing was spent on), with Trimming underneath (the heavy days show).

**Proven where:** the GitHub contribution graph made the calendar heatmap the
habit chart nearly everybody can already read, and habit trackers and
spending apps have borrowed it since. It answers the question a list cannot:
_which days are expensive, and is there a pattern_ — the weekend, the payday,
the first of the month.

```
┌ Kalendář útraty ────────── 14 497 Kč ┐  ← the month so far
│  P   Ú   S   Č   P   S   N           │
│              ●   ●   ●   ●           │  ← ink: darker = dearer
│  ●   ○   ○   ○   ○   ○   ○           │  ← mint: nothing spent
│  ○   ○   ○   ○   ○   ○  (○)          │  ← today, ringed
│  ◌   ◌   ◌   ◌   ◌   ◌   ◌           │  ← days to come, empty rings
│ Nejvíc po 5. října · 5 553 Kč ·      │  ← or the tapped day
│ 13 dní bez výdaje                    │
└──────────────────────────────────────┘
```

**The scale is quartiles of the month's own spending days**, not a share of
the most expensive one. Against the maximum, rent day washes every other day
out to the same pale; quartiles keep the pattern readable in a month with a
five-figure day in it. Four steps of ink, because money out has no hue and
four classes is the most a reader can tell apart at a glance.

**A day that cost nothing is mint**, the colour of a verdict that came out
right — the same no-spend day Přehled counts (`coverage.ts`). Tapping a day
says what it cost and how many rows; tapping it again goes back to the
month's line.

**Built:** `spendCalendar` in `domain/charts.ts`, `ui/CalendarCard.svelte`.

**Next:** a tap that opens the day on Výpis (the day is already the tape's
unit); the previous month by swiping the card sideways, the way the dues deck
swipes. Neither is needed to judge whether the card earns its place.

---

## (b) Rozdělení příjmu — the 10/10/10/70 split people can read · **built on Domů**

**Law:** Trimming — the shape of income, decided before the month.

**Why the ring failed.** The ring on Přehled asks the reader to do three
things at once: compare four arcs by angle (the weakest perceptual channel
there is), read a percentage in the hole that is a fifth quantity ("zbylo"),
and decode a column of signed deltas (`+3`, `−7`) whose unit is percentage
points of income. Three encodings for one question, and the question the book
actually asks — _did I give, save and pay down what I meant to_ — is answered
by none of them directly.

**The replacement: four meters, each against its own mark, in koruny.**

```
┌ Rozdělení příjmu ────────── Naplánovat ┐
│ Spoření: 4 % místo 10 %. Tohle je ta    │  ← the verdict, unchanged
│ jedna věc.                              │
│ Dávání              5 200 z 5 200 Kč    │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ (mint)   │
│ ✓ splněno                               │
│ Spoření             2 000 z 5 200 Kč    │
│ ▬▬▬▬▬▬▬▬▬▬▬▬───────────────────         │
│ chybí 3 200 Kč                          │
│ Dluh a rezerva          0 z 5 200 Kč    │
│ ───────────────────────────────         │
│ chybí 5 200 Kč                          │
│ Život              30 400 z 36 400 Kč   │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬───── (mint)  │
│ ✓ zbývá 6 000 Kč                        │
│ Příjem 52 000 Kč · zbylo 14 400 (28 %)  │
└─────────────────────────────────────────┘
```

Each row is the **meter** every other screen already uses for "how far
along" — the goal's, the dues' — so nothing new has to be learnt. Giving,
saving and debt fill toward their 10 %; mint once reached. Living fills toward
its 70 % as a budget: mint while under it, amber once over. The line under
each meter is the answer in words and koruny: _splněno_, _chybí 3 200 Kč_,
_zbývá 6 000 Kč_, _o 2 000 Kč přes_. Percentages are gone from the rows on
purpose: 9.6 % rounds to "10 % z 10 %" beside "chybí 200 Kč", and the two
contradict each other; the koruny do not round.

**Built:** `splitBars` in `domain/prosperity.ts`, `ui/SplitCard.svelte`, as a
card for Domů — and, since Q94, in place of the ring on Přehled. The ring
survives only as the small glyph it already is in the tab bar.

---

## (c) Vývoj zůstatku — progress over a day, week, month, year, everything · **built**

**Law:** Targeting — where the money is heading, not only where it is.

**Proven where:** this is the chart a brokerage and a neobank lead with
(Revolut, Robinhood, every banking app's account screen). It is the one shape
nearly everybody already reads: a figure, the change under it, a line with a
wash beneath, and a pill of ranges — 1D · 1W · 1M · 1Y · MAX — which in Czech
is _Den · Týden · Měsíc · Rok · Vše_.

```
┌ Vývoj zůstatku ───────────────── CZK ┐
│ 98 794,00 Kč                          │  ← the balance, or the scrubbed day
│ +18 217,00 Kč za měsíc                │  ← mint when up, ink when down
│ [ Den | Týden | Měsíc | Rok | Vše ]    │
│                         ╭──•          │
│ ──────────────────────  │             │  ← hairline: where the range began
│ ╲___________________╱                 │
│ Pá 18. září                      dnes │
└───────────────────────────────────────┘
```

**What is drawn** is the balance of the active currency — every account in
it, from each account's opening day, so a card added in September does not
lift August. A move between two koruna accounts cancels out, as it should.
**Den** is today, row by row, in the order they were written; every other
range is the balance at the end of each day, and _Vše_ past 400 days is drawn
a week at a time. **A range longer than the ledger starts at the ledger's
first day** and says _od začátku_ instead of _za rok_ — a line of zeros before
anything was recorded would be a claim about a year nobody wrote down.

**The hairline at the range's first value** is what makes up and down
readable without a y axis. A finger on the line moves a crosshair; the
figure on top becomes that day's balance and the line under it names the day.

**Built:** `balanceSeries` in `domain/charts.ts`, `ui/BalanceCard.svelte`.

**Next — net worth, not only cash.** `Jmění celkem` is cash plus stated
holdings. The same chart over `wealthTotal` needs the valuations stepped in
at the day they were true (`Valuation.date`), and a stale value drawn as a
flat line with the stale badge, never interpolated — a guess drawn as a curve
is a guess pretending to be data. Worth doing once holdings have a few months
of readings; until then the line would be mostly steps.

---

## (d) What else is proven, and what to do with each

### d1. Tempo útraty — spending pace against last month · **built**

**Law:** Trimming, and Training: it is the comparison that changes behaviour
while there is still month left to change it in. A month total arrives on the
1st, when nothing can be done about it.

**Proven where:** the budgeting apps that people keep using (Copilot, Monarch
among them) put this on their home screen — cumulative spending this month as
a line, last month's as a quieter line behind it, and one sentence. It works
for the reason a sports score works: it is a running total with a rival.

The sentence compares **the same day**: the 18th against the 18th, or a
shorter month's last day. Mint when spending slower, amber when faster. Last
month's line is solid and quieter, never dashed (rule 7). With no last month
there is nothing to compare, and the card says so.

**Built:** `spendPace`, `ui/PaceCard.svelte`.
**Next:** "than usual" — the mean of the last three months instead of one,
using `trends.ts`'s window, once there are three months to average. One month
is noisy; it is what there is today.

### d2. Cash flow — income against outflow, month by month · **recommended next**

Two bars per month for the last six, in and out, and the net as a figure on
each pair. Monarch's _Cash Flow_, YNAB's _Income v Expense_. It answers the
question four of the workbook's eight months got wrong without anybody
noticing — _did the month spend more than it earned_ — as a pattern rather
than as one month's red figure. `trends.ts` → `monthlyRows` already has the
numbers. Law: Tracking. **Recommendation: build it next, for Přehled**, not
Domů — it is a look back, and Přehled is where months are read.

### d3. Savings rate over time · **recommended, after d2**

One line: the share of earned income that did not go to living — given,
saved, paid down, or left over — month by month, with the book's 30 % as a
hairline. It is the figure most personal-finance writing treats as the lever
on building wealth, and the record Training needs. It is `prosperitySplit`
per month, already computable. Law: Training.

### d4. Upcoming payments — the month ahead · **recommended, small**

The declared schedules as a short list of the next fourteen days with a
running total — _Odchází do konce měsíce 18 400 Kč_ — the "upcoming bills"
strip every budgeting app has. `remainingThisMonth` in `recurring.ts` already
computes the total. Law: Targeting (what is already spoken for). It is a list,
not a chart, and that is the point: four rows read faster than a calendar.

### d5. Category trend as small multiples · **already half there**

Přehled's _Kam to šlo_ already carries a trend per bucket (`trends.ts`). Small
multiples — a six-month sparkline beside each bucket — would show which ones
are creeping. Worth doing only if a trend line ever tells you something you
did not know (`TODO.md` §5 is watching exactly that).

### Refused, and why

- **A health score or a gauge.** A compounded number cannot be acted on when
  it moves (R4 in `TRIMMING-AND-TRAINING.md`). A speedometer is the same
  number with a needle.
- **A Sankey of income into buckets.** Beautiful in a demo and unreadable on a
  375 px screen past five flows; the split meters say the same thing in four
  rows.
- **Pie charts of categories.** More than five slices cannot be compared by
  angle; Přehled's ranked bars already do it.
- **Forecast lines.** A projection drawn like data gets read as data. The
  app states what happened; the goal's pace is the one forward-looking figure,
  and it is a sentence, not a curve.

---

## How they are arranged

Nastavení › **Domů**: the cards in order, ↑ ↓ to move, _Skrýt_ to hide,
_Přidat_ for what is hidden. Domů itself carries no control for it. The
month's net, the dues and the holds stay where they are and are not on the
list (`domain/dashboard.ts`).

## Answered, 2026-10-18 (Q94, Q95)

1. **Přehled's ring → the split meters?** Yes — replaced.
2. **Which charts by default?** All four. Until Domů is arranged, every card
   is shown.
3. **Should the arrangement sync between devices?** Yes. It is a synced
   `Layout` row (schema v16, backup format 8); every paired device shows the
   same Domů, and the newest arrangement wins.
