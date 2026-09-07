# Screens

Captured 2026-09-07 from the third-edition build on a 390 × 844 viewport at
3×, against demo data — nothing here is a real ledger. Three of them are
embedded in the root README; the rest document the remaining screens in both
themes.

| File                      | Screen                                          |
| ------------------------- | ----------------------------------------------- |
| `domu-dark.png` / `-light` | Domů — net, a payment to confirm, goal, wealth |
| `zapis-dark.png` / `-light` | Zápis — the keypad with a check firing        |
| `vypis-dark.png`          | Výpis — the tape with running balances          |
| `prehled-dark.png` / `-light` | Přehled · Měsíc                              |
| `prehled-platby-dark.png` | Přehled · Platby — declared recurring payments  |
| `cil-dark.png`            | Cíl — the goal, its month, the record           |
| `jmeni-dark.png`          | Jmění — holdings and a stale valuation          |
| `nastaveni-dark.png`      | Nastavení — the hub                             |

To retake them: build, run the preview, load a demo backup through
Nastavení → Data, and capture each route with Playwright at `scale: 'device'`.
