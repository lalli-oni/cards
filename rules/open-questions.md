# Open Questions

Gaps and unresolved design questions identified from the current rules.
Resolved items should be removed from this file and written into the
relevant rule files.

## Seeding

### 17. Middle area naming
The shared face-up area where exposed cards are placed during seed
rounds needs a thematic name.

### 18. Seed round ratios
Each seed round a player draws from their seeding deck: some cards go
to market deck, some go face-up to the middle area. Current working
ratio is 8 kept / 2 exposed — needs playtesting. Also: should the
ratio be fixed or vary by round (e.g. expose more in later rounds)?

### 19. Grid full during seeding
When a stolen location must be placed on the grid but the grid is
already fully populated, what happens? Options:
- The stealing player replaces an existing location (which one? their
  choice? opponent's choice?)
- Excess locations go to the player's prospect deck instead
- Grid expands dynamically (probably not — grid size is a variant value)
- Locations can no longer be stolen once the grid is full

### 20. Primary objective mechanic
Should players publicly declare a mission they're committed to during
seeding (for bonus VP), creating a readable game state from turn 1?
Opponents would know your target. Needs design:
- When is it declared? (during seeding, after grid is populated?)
- What's the bonus for completing your declared mission?
- Can it be changed mid-game?
- Is it mandatory or optional?

### 21. Deck construction after seeding
After seed rounds and stealing are complete, each player has a pile of
kept cards. How are these split into market deck / main deck / starting
hand? Current working model:
- Locations go to prospect deck (top/bottom split for timing control)
- Remaining cards form the market deck
- Player draws [var:X] from market deck → main deck, shuffles
- Player draws [var:Y] from main deck → starting hand
- Exact values of X and Y need definition

### 22. Steal order within a seed round
When multiple cards are in the middle area after all players have drawn,
what order do players pick? Options:
- Fixed turn order (starting player advantage)
- Reverse turn order (compensates for going last in draw phase)
- Snake draft (alternating direction each round)

## New Card Types

### 13. Dilemmas
Inspired by the Star Trek CCG dilemma system. Dilemmas are a new card
type seeded face-down under missions during the Seeding Phase. They
add difficulty/obstacles that players must overcome before completing
a mission. Needs full design:
- How are dilemmas seeded? (under specific locations, or under grid
  slots before locations are placed?)
- How many dilemmas per location?
- When are they revealed? (when a player first attempts the mission?
  when units arrive?)
- What do they do? (stat checks, resource costs, unit sacrifices,
  temporary blocks?)
- Are they part of the library or a separate pool?
- Do they count toward deck-building limits?

## Items & Equipment

### 12. Equipment types and carry limits
Should items have types (e.g. vehicle, weapon, tool, small) that affect
how many a unit can carry? For example: a unit can carry 1 weapon +
1 vehicle + unlimited small items. Or a flat numeric limit. Needs
definition to prevent stacking abuse.

## Economy & Resources

### 15. Alternative resources beyond gold
Gold is the universal resource. Some cards or strategies could
introduce alternative resources that only certain players accumulate,
creating asymmetric economies. Possible resource types:
- **Diplomatic Favor** — gained through negotiation, alliances,
  politician-type units. Could be spent on special actions or as
  alternative costs on certain cards.
- **Influence** (cult of personality / spiritual) — gained through
  Spiritual-attribute units, certain locations. Could fuel powerful
  but situational effects.
- **Authority** (authoritarian / military) — gained through Warrior
  units, control of locations. Could enable forced actions on
  opponents.

Key design questions:
- Are these tracked per-player like gold, or are they tokens on
  specific cards/locations?
- Can they be spent as alternative costs (printed on cards alongside
  gold), or do they unlock entirely different actions?
- Are they universal (all players can earn any type) or tied to
  specific unit attributes/strategies?
- How are they earned — unit abilities, location effects, policies?

## Minor

### 10. Single player support
Core Architecture says 1+ players but Baseline Variant says 2+.
The seeding phase relies on opponents (next player draws for you,
policy passing left). Is single player a future variant, or should
baseline support it?

### 11. Keyword system detail
Currently just two categories (Static, Triggered) with no examples
or resolution rules. Is this intentionally minimal for now, or does
it need expansion?
