# Master Design Document

## Core Architecture
- Players: 1+ players.

- Victory: Point-based with a turn limit. Highest score wins.

## Phases
Starting player is picked randomly.

All phases consist rounds.

In each round every player gets a turn, first starting player and then going clockwise until last player ends their turn.

### Seeding phase
The full deck **library** for seeding is shuffled and placed top‑down.
Each player’s library may contain at most **8 legendary** and **24 epic**
cards; these rarity limits apply to the library as a whole.  Policies
are not part of the library and do not count toward these totals.

Players select cards to bring to the Main Phase.  In the baseline
variant (see below) each player will end the seeding phase with **4**
cards in their seeded deck.

Players also select policy cards which can have effect on the seeding.
Policy selection happens in a separate draft exchange (see Policy
selection, below).

#### Player turn
The player who will next take a seed turn (or starting player, if the active player is last) gets to draw the top card of the active players library. He decides whether to discard the card or hand it over to the active player.

The active player draws until they have 5 cards in their hand.

They choose 2 cards to add to their seeded deck and discard the rest.

If players deck library runs out, shuffle the discard pile.

#### Policy selection
1. Each player presents three policy cards from their chosen pool.
2. Pass your three to the player on your left; that player takes one and returns the other two.
3. Once all players have returned the unchosen policies, pick one more policy from the returned pool.

Each player therefore starts the game with two policies. These policies are outside of the deck‑library size and rarity limits.

### Main Phase


#### Player turn


## Card Types
### Units
Based on historical figures.
Stats (for example; strength, cunning, charisma).
Any stats not listed on the card are treated as [var:default_stat:5].
Attributes (for example: Scientist, Politician, Engineer, Warrior, Spiritual)
Actions: Units can have various actions that players can activate.


### Locations
Locations can have missions and effects.

#### Missions
Main source of VP's.
A player completes the mission as soon as they fulfill all the requirements.
Upon completion the Location is put face-up in front of player.

## Items
Can be equipped by units or stored in locations.
Equipped items are dropped when units are injured.

- Events: Cards that produce a wide range of effects. Events come in

  - Instant: One-time effects played from hand and resolved immediately.
  - Passive: Ongoing or timed effects that remain active for a printed
    duration (e.g. "for X turns").
  - Trap: Face-down cards intended to trigger when a condition is met.
  Events are drawn from a player’s library but are normally not placed
  in the public market when drawn during market population; see the
  Market Rules for the draw mechanic and timing details.

- Policies: Static global modifiers. Selected at start via the Policy selection draft (do not count against library limits).

## Keyword System
- Static: Passive effects.

- Triggered: Effect is triggered when condition is fulfilled.

## Economy
- Each player begins with **10 gold** (baseline variant).
- **Card costs are printed on the cards** and are independent of rarity;
  designates that a common may cost more than a legendary or vice versa.
  Rarity affects draw and deck‑building limits but not the gold price.
- Gold is used to purchase cards in the market, pay for ability costs, and
  satisfy certain policy effects.

> See [Market and Economy Rules](market.md) for full details on how the
> shop works, optional variants, and policy interactions.

## Variants
### Baseline Variant (Default)
- Players: 2+


#### Seeding
- Deck size: 40 (only 4 cards are seeded initially in the baseline variant)
- Rarity caps on library: 8 legendary, 24 epic (applied per‑library)
- Seeding is allowed from any deck collection.


- Turn Limit: 20 Turns
- Victory Condition: First to 50 Victory Points or highest score at Turn 20.

- Starting Resources
    - 10 gold
