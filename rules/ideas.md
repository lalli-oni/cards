# Ideas

Feature ideas and design explorations to revisit after v1.0 rules are
finalized. These are not part of the current rules.

## Market & Events

### Event draw mechanic during market population
When populating the market, events drawn go straight to the player's
hand (keep drawing until a non-event is drawn for the market slot).
This can create uneven hand advantages — one player might draw several
free events while another draws none. Questions to revisit:
- Is the variance acceptable or frustrating?
- Does hand size limit (7) sufficiently cap the advantage?
- Should there be a limit on consecutive event draws?
- Alternative: events go to market like other cards, but cost 0 gold
  to buy (still costs AP to play). Removes draw luck, keeps events
  accessible.

## Seeding

### Variable seed round ratios
Instead of a fixed 8 kept / 2 exposed split every round, the ratio
could change across seed rounds to shift tension. For example:
- Expose more in later rounds (7/3, 6/4) to increase interaction
  as seeding progresses
- Expose more in early rounds when the grid is empty and players
  need locations
- Could be a variant value per round

### Primary objective mechanic
Players publicly declare a mission they're committed to during
seeding (for bonus VP), creating a readable game state from turn 1.
Opponents would know your target. Design questions:
- When is it declared? (during seeding, after grid is populated?)
- What's the bonus for completing your declared mission?
- Can it be changed mid-game?
- Is it mandatory or optional?

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

## Economy & Resources

### Alternative resources beyond gold
Gold is the universal resource. Alternative resources could create
asymmetric economies tied to player strategies. Possible types:
- **Diplomatic Favor** — gained through politician-type units,
  negotiation. Spent on special actions or alternative card costs.
- **Influence** (spiritual) — gained through Spiritual-attribute
  units, certain locations. Fuels powerful but situational effects.
- **Authority** (military) — gained through Warrior units, location
  control. Enables forced actions on opponents.

Design questions:
- Tracked per-player like gold, or tokens on cards/locations?
- Alternative costs on cards, or unlock entirely different actions?
- Universal (any player can earn any type) or attribute-tied?
- Earned how — unit abilities, location effects, policies?

## Variants

### Single player / pre-seeded variant
The seeding phase is marked `[var:seeding-phase]` and can be replaced
entirely. A pre-seeded variant would skip seeding and provide players
with pre-constructed decks (main deck, prospect deck, market deck)
and a pre-populated grid, jumping straight into the main phase.
This enables:
- Single player support (no opponents needed for seeding)
- Quick play (skip the longest setup phase)
- Tutorial mode (learn main phase mechanics first)
