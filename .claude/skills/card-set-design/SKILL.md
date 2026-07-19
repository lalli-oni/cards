---
name: card-set-design
description: Set-level design philosophy and the iteration loop for building a coherent, playtest-ready card set. Use when designing a new set, deciding what a set as a whole should contain, or refining an existing set toward playability. For crafting a single card, use card-design instead.
---

# Card Set Design

Design a **set as a whole** — the shape of the pool, the archetypes it supports,
and the loop that moves it from rough to playable. This is distinct from
crafting one card well (the `card-design` skill) and from designing the game's
rules/mechanics (`rules/design-principles.md`).

Load this skill and keep it in mind for the duration of a set-design session.

## Arguments

- Free-form description of the set-level goal. Examples:
  - "shape the alpha-1 set for first playtest"
  - "audit alpha-1 for dead archetypes"
  - "which archetypes still lack a payoff card?"
- Optional: target set (defaults to `alpha-1`).

## Philosophy

### Playtest-appropriate > balanced

The goal of an early set (e.g. alpha-1) is a set that is **playable**, not one that
is fully tuned. Perfect balance is a moving target that only real play reveals;
chasing it before the set is playable wastes effort on numbers that will move.
Ship something you can play, then tune from evidence.

### Coverage before balance

Represent every mechanic and archetype **before** fine-tuning any numbers. A set
that covers its intended strategies at rough power levels is more useful than a
half-covered set with three perfectly-tuned cards. Breadth first, then depth.

### No dead archetypes — ≥2 viable strategies

Every archetype the set gestures at should have a real path to the win
condition; an archetype with no payoff is a trap that punishes the player who
believes the set's own signposting. Aim for **at least two** viable, distinct
paths to accumulating VP so deckbuilding is a genuine choice, not a solved line.

### Bounded, learnable pool

Keep the pool small enough that a player memorizes the core after a few games.
A learnable set produces faster, richer decisions and cleaner playtest signal;
an oversized early pool dilutes every archetype and slows the loop. Add cards
because an archetype needs them, not to hit a count.

### Deliberate rarity distribution

The rarity mix (see **Rarity** in `rules/README.md`) is a design lever, not an
afterthought.
Commons form the backbone every deck leans on; rarer slots carry the
build-around payoffs. Decide the intended distribution across the set and check
the actual pool against it — skew reveals archetypes that are over- or
under-supported.

## The iteration loop

Set design is iterative. One pass through the loop:

1. **Edit** — add or adjust cards in `library/sets/{set}/*.csv` (VisiData or a
   spreadsheet; see the root `CLAUDE.md` → Card Library workflows).
2. **Build** — `bun library/build.ts` to validate the CSVs and regenerate JSON.
   A failed build is the first gate; fix it before going further.
3. **Audit** — check the set against the rules and against coverage:
   - `card-rule-review` skill for card↔rules consistency.
   - `card-query` skill for coverage/rarity/cost distribution over the pool.
   *(Deeper analysis tooling — archetype taxonomy #192, EV/value model #193 —
   plugs in here as it lands.)*
4. **Play** — `play-game` skill to exercise the set in real games and surface
   dead archetypes, unbeatable lines, and non-decisions.
5. **Query sessions** — `session-query` skill over the resulting session data:
   win rates, game length, card usage, archetype performance.
6. **Tune** — feed those findings back into step 1. Repeat until the set is
   playtest-appropriate across its intended archetypes.

Coverage gaps are found in steps 3–5; balance is tuned in step 6. Resist tuning
numbers before coverage is in place (see **Coverage before balance**).

## Related principles (DRY)

These docs are the canonical source; this skill points at them rather than
restating:

- **Individual card craft** — `card-design` skill, plus the **Card Craft**
  section of `rules/design-principles.md` (no dominated/feel-bad cards;
  synergy with counterplay).
- **Rules & mechanics design** — `rules/design-principles.md` (counterplay,
  complexity budget, keyword/DSL-verb design, decide-the-data-model-first,
  mechanic composition).
