# Effect System

How the engine expresses "what a card does." There are **three surfaces**, each
suited to a different shape of behavior. This doc is the map; each surface has
its own doc.

## The three surfaces

| Surface | Lives in | Driven by | Good for |
|---|---|---|---|
| **Effect DSL** | `engine/src/effect-dsl/` | the card `effect` column (+ action effects) | imperative, one-shot effects (`injure`, `gold`, `draw`, `move`, `contest`…) |
| **Effect factories / listeners** | `engine/src/listeners/effects.ts` | hand-written, keyed by `definitionId` | stateful / triggered / continuous behavior, and stat/cost/protection modifiers |
| **Keywords** | `engine/src/keywords.ts` | the card `keywords` column | named, governed, reusable, iconed abilities (shared vocabulary) |

See [effect-dsl.md](effect-dsl.md) and [keywords.md](keywords.md).

## 1. Effect DSL

A small language for a card's imperative effects, stored as text in the `effect`
CSV column and executed at resolution — verbs like `injure`, `gold`, `draw`,
`peek`, `move`, `contest`. Example: Earthquake's `injure(all + here) +
remove(location)`. Full grammar and verb list in [effect-dsl.md](effect-dsl.md).

## 2. Effect factories / listeners

For behavior the DSL can't express — anything **stateful, triggered, or
continuous**. `engine/src/listeners/effects.ts` holds factories keyed by card
`definitionId`; each returns an `EffectDefinition` with two kinds of member:

- **`listeners`** — fire on game events (`turn_started`, `unit_entered`,
  `combat_resolved`, …). E.g. The Silk Road grants gold each turn; the trap
  discard path (`discardTrap`).
- **`queries`** — answer live questions about state ("what is this unit's
  strength / this action's cost / is this position protected?"). These are the
  stat / cost / AP / protection modifiers, aggregated in
  `engine/src/listeners/query.ts`.

Registries: `LOCATION_EFFECTS`, `POLICY_EFFECTS`, `PASSIVE_EVENT_EFFECTS`,
`TRAP_EFFECTS`, `ITEM_EFFECTS`, `UNIT_EFFECTS`, plus `POLICY_ACTIONS`.

## 3. Keywords

The governed, named vocabulary of reusable abilities (modifier families
Prowess / Kindred / Leader / Aura, plus standalones like Berserker, Untouchable,
Heavy). The card `keywords` column carries them; `keywords.ts` is the source of
truth for what exists and how each token parses. The build validates every token
and emits `library/build/keywords.json`; the renderer draws keyword pills from
it.

**Current runtime status:** keywords are **parsed, validated, and rendered**
today, but the engine does not yet **resolve** their effects at runtime — that
wiring is tracked in [#212](https://github.com/lalli-oni/cards/issues/212). See
[keywords.md](keywords.md).

## How the three relate

They overlap by design pressure, not accident: `Prowess:+2:strength:combat` (a
keyword) is conceptually the same as a stat-modifier query (surface 2) or a DSL
`buff` (surface 1) — the keyword is just the *named, governed, reusable, iconed*
form of that effect.

Today they are three distinct mechanisms.
[#208](https://github.com/lalli-oni/cards/issues/208) is an **open architectural
proposal** to eventually unify keywords / actions / passives under one effect
grammar (with "keyword" becoming a *property* of an effect). That is a future
reconsideration — **not a commitment, and not a plan to remove keywords**. Until
and unless it lands, pick the surface by the table above.

## File map

| Path | Role |
|---|---|
| `engine/src/effect-dsl/` | the DSL — `tokens.ts`, `parser.ts`, `validate.ts`, `executor.ts`, `verbs.ts` |
| `engine/src/listeners/effects.ts` | effect factories + registries |
| `engine/src/listeners/query.ts` | query aggregation (stat / cost / AP / protection) |
| `engine/src/keywords.ts` | governed keyword vocabulary |
| `library/build/keywords.json` | build artifact consumed by the renderer |
