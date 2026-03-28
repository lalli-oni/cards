# Ideas

Feature ideas and design explorations to revisit after v1.0 rules are
finalized. These are not part of the current rules.

## Seeding

### Dilemmas on non-mission locations
Allow dilemmas to be placed under non-mission locations, not just
missions. Would need a different trigger mechanism (e.g. unit arrival)
since non-missions don't have an "attempt" action. Could add grid
navigation tension but increases complexity.

## Combat

### Simplify to 1v1 combat only
Multi-unit combat (commit multiple units, roll d6 per unit, defender
assigns matchups) adds tactical depth but may be too complex in
practice. Investigate whether removing multi-unit combat in favor of
strict 1v1 (one attacker vs one defender) produces a cleaner game.
Trade-offs:
- 1v1 is simpler to resolve and explain
- Multi-unit creates interesting commit/matchup decisions
- 1v1 makes individual unit strength more decisive
- Multi-unit rewards positional play (stacking units at key locations)
- Keywords like Duelist become redundant in a 1v1 system
Playtest both and compare.

## Items & Equipment

### Multiple item types per card
Allow items to have more than one type (e.g. a bayonet that is both
Weapon and Tool). Would enable more flexible targeting by card effects
but adds complexity to type checks.

## Variants

### Pre-seeded variant
The seeding phase is marked `[var:seeding-phase]` and can be replaced
entirely. A pre-seeded variant skips seeding and provides players
with pre-constructed decks (main deck, prospect deck, market deck)
and a pre-populated grid, jumping straight into the main phase.
This enables:
- Quick play (skip the longest setup phase)
- Tutorial mode (learn main phase mechanics first)
- Single player support (see #31)

Engine support landed in #44: callers set `seeding-phase: "pre-built"`
in variant overrides, then use `buildPrebuiltDeckInput()` to construct
the deck input with pre-populated grid, market, and per-player gold.
