# Keywords

The engine's **governed vocabulary of mechanical keywords** — the shared, named,
reusable, iconed shorthand for "what a card does," carried in the card
`keywords` column. This is an **active system**: keywords are authored on cards,
validated by the build, and rendered as pills today. One of the three
[effect surfaces](effect-system.md).

## Source of truth

`engine/src/keywords.ts` — the `KEYWORDS` array is the closed vocabulary, kept in
sync with the rules Keyword Glossary. `parseKeyword(token, cardType)` validates a
token and returns a `ParsedKeyword`.

## The vocabulary

**Modifier families** — parameterized stat effects sharing the shape
`Name:±MAG:STAT-SCOPE:CONTEXT[:ROLE]` (e.g. `Prowess:+2:strength:contest`,
`Leader:+1:all:contest`, `Aura:-1:all:contest:def`):

| Keyword | Card type | Affects |
|---|---|---|
| `Prowess` | unit | this unit |
| `Kindred` | unit | other friendly units sharing an attribute with this unit |
| `Leader` | unit | friendly units at this location, including this unit |
| `Aura` | location | every unit at this location — friend or foe |

**Standalone keywords:**

| Keyword | Card type | Params | Meaning |
|---|---|---|---|
| `Untouchable` | unit | `stat` | can't be Attack-targeted while its `stat` exceeds every attacking unit's |
| `Berserker` | unit | — | on winning combat, injures itself and kills the loser instead |
| `Patron` | unit | `amount` | cards you buy or deploy sharing an attribute with it cost `amount` less gold |
| `Loot` | unit | — | on killing an enemy in combat, draw a card |
| `Squire` | unit | `amount` (opt, default 1) | your Equip actions cost `amount` less AP |
| `Flying` | item | — | equipped unit ignores blocked edges between locations when moving |
| `Heavy` | item | — | equipped unit's Move action costs +1 AP |
| `Lightweight` | item | — | equipped unit's Move action costs 1 less AP |

## Grammar

`Name:param1:param2:…` — colon-separated, positional, typed. `ParamKind`s:

| Kind | Accepts |
|---|---|
| `signedMagnitude` | signed integer, sign required (`+2`, `-1`) |
| `magnitude` | positive integer |
| `statScope` | a stat, or `all` |
| `stat` | a stat (no `all`) |
| `context` | `contest` \| `mission` |
| `role` | `atk` \| `def` \| `either` |

Names and enum params are **case-sensitive**, so card data and code can't drift
on spelling. Optional params are trailing-only. `parseKeyword` throws
`KeywordError` on an unknown name, an unsupported card type, wrong arity, or a
malformed parameter — so bad data **fails the build**.

## Build and render

The build validates every card `keywords` token against `keywords.ts` and emits
`library/build/keywords.json` (name, `cardTypes`, and param specs per keyword).
The Penpot renderer reads that artifact to draw keyword pills and compose
reminder prose from each spec's `reminder` template (with `{param}`
placeholders).

## Runtime status (current)

Keywords are **parsed, validated, rendered, and resolved**. `keyword-effects.ts`
converts a card's `keywords` tokens into the same `{listeners, queries}` shape
the bespoke `*_EFFECTS` factories produce, and `rebuildListeners` calls it for
every card it visits — so e.g. `Prowess:+2:strength:contest` applies as a stat
modifier during a contest exactly like a hand-written effect factory would.
See [effect-system.md](effect-system.md) for how this fits the other two
effect surfaces.

## Relationship to the wider effect system

Keywords are the *named, governed, high-reuse* form of a stat / cost / trigger
effect; the same behavior can also be expressed as a listener/query factory or a
DSL verb (see [effect-system.md](effect-system.md)).
[#208](https://github.com/lalli-oni/cards/issues/208) is an open proposal to
eventually unify keywords / actions / passives under one effect grammar — a
future architectural reconsideration, not a plan to remove keywords.

## Adding a keyword

1. Add a `KeywordSpec` to `KEYWORDS` in `keywords.ts` (`name`, `cardTypes`,
   `params`, `reminder`).
2. Add the matching entry to the rules Keyword Glossary — keep the wording in
   sync with the `reminder`.
3. Rebuild (`bun library/build.ts`) — the build validates it and emits it to
   `keywords.json` for the renderer.
4. Wire its runtime semantics: either add a case in `keyword-effects.ts`'s
   `keywordEffects` switch, or — if it doesn't fit the query/listener shape —
   implement it as a direct hook and list it in `DIRECT_HOOK_KEYWORDS`.
   `test/build.test.ts` fails on a keyword that is neither, so it can't ship
   inert.
