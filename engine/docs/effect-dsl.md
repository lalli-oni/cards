# Effect DSL

A small text language for a card's **imperative effects** — what happens when the
card (or one of its actions) resolves. Stored in the `effect` CSV column and in
action / policy-action effect strings, and executed by the engine at resolution.
One of the three [effect surfaces](effect-system.md).

## Pipeline

```
effect string → tokens (tokens.ts) → parser (parser.ts) → validate (validate.ts) → executor (executor.ts)
```

`tokens.ts` is a chevrotain lexer; `verbs.ts` is the governed verb registry and
mirrors the executor's dispatch (adding a verb means updating both).

## Verbs

`VERBS` in `verbs.ts`:

| Verb | Does |
|---|---|
| `gold` | gain / lose gold |
| `vp` | gain victory points |
| `draw` | draw cards from the main deck |
| `peek` | look at the top N of a deck, or an opponent's hand |
| `pick` | choose from previously `peek`ed cards |
| `buy` | buy a card from the market |
| `kill` | kill a unit |
| `injure` | injure a unit |
| `buff` | apply a stat buff |
| `move` | move a unit |
| `control` | take control of a unit |
| `remove` | remove a location from the grid |
| `raze` | raze a location |
| `to` | send/place a card to a destination (currently `to(hq)` for a razed location) |
| `contest` | initiate a stat contest |

## Syntax

- **Verb call:** `verb(target)[value]` — target in parens, numeric value in
  brackets. e.g. `gold[3]`, `draw[2]`, `injure(enemy)`.
- **Targets / tokens:** combine with `+` inside the parens — `all + here`,
  `opponent + hand`, `all + friendly`. Common tokens: `all, here, friendly,
  enemy, opponent, self, hand, deck, location, hq`.
- **Sub-verb (`.`):** `contest.strength(enemy)` — a strength contest;
  `buff.cunning(friendly)[2]`.
- **Chaining:** `+` sequences effects (`move(self) + gold[1]`); `>` pipes one
  step into the next (`peek(deck)[3] > pick[1]` — peek the top 3, then pick 1).
- **Modifiers (`~`):** trailing qualifiers, e.g. `~round` / `~turn` (duration),
  `~ignore_blocked` (movement).
- **Actions** (the `actions` column on units / policies) use `:` —
  `name:apCost:effect`, e.g.
  `diplomacy:1:contest.charisma(enemy + same) > control(target)~round`.

## HQ-safe verbs

`gold, vp, draw, peek, pick, buy` operate purely on player state (no grid
position), so they can run from HQ where the acting card has no grid
coordinates. Other verbs need grid context. (`isHqSafeVerb` in `verbs.ts`.)

## Examples (real cards)

| Card | `effect` / action |
|---|---|
| Earthquake (event) | `injure(all + here) + remove(location)` |
| Harvest Festival (event) | `gold[3]` |
| Ada Lovelace (unit action) | `analyze:1:peek(deck)[3] > pick[1]` |
| Genghis Khan (unit action) | `conquer:3:raze(location) > to(hq)` |
| Cleopatra (unit action) | `diplomacy:1:contest.charisma(enemy + same) > control(target)~round` |

## Adding or changing a verb

Keep three files in sync: add the verb to `VERBS` in `verbs.ts`, implement its
dispatch in `executor.ts`, and add its validation in `validate.ts`.
