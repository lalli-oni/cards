# Master Design Document

> See [Design Principles](design-principles.md) for meta-level goals
> that guide rule design.

## Core Architecture
- Players: 1+ players.

- Victory: Point-based. The game ends at the end of a round in which any
  player has reached [var:vp_threshold:50] VP, or at the end of round [var:turn_limit:20] —
  whichever comes first. When the game ends, the player with the most VP
  wins. If tied, play additional rounds until one player has the sole
  highest VP at the end of a round.

## Phases
Starting player is picked randomly.

All phases consist rounds.

In each round every player gets a turn, first starting player and then going clockwise until last player ends their turn.

### Seeding Phase
Each player brings a **seeding deck** of [var:seeding_deck_size:40] cards (shuffled).
Each seeding deck may contain at most **8 legendary** and **24 epic**
cards; these rarity limits apply per deck. Policies are not part of
the seeding deck and do not count toward these totals.

#### 1. Seed rounds
Repeat seed rounds until all players' seeding decks are empty. Each
seed round:

1. **Draw**: In turn order, each player draws [var:seed_draw:10] cards from their
   seeding deck. Keep [var:seed_keep:8] for your **market deck** (face-down).
   Place [var:seed_expose:2] face-up in the shared **middle area**.
   [design: If a player has fewer cards remaining than [var:seed_draw:10], they
   draw what they can and split proportionally (round up for market
   deck, remainder to middle area).]
2. **Steal**: After all players have drawn, players take turns picking
   one card from the middle area. Repeat until the middle area is
   empty. Stolen **locations** must be placed on the grid immediately
   (the stealing player chooses slot and orientation). Other stolen
   cards go to the stealer's market deck.
   Non-stolen cards — there are none; players continue picking until
   the middle area is empty.

#### 2. Deck construction
After all seed rounds are complete:

1. **Prospect deck**: Each player removes all locations from their
   market deck. Divide locations freely into a **top half** and
   **bottom half**, shuffle each separately, then stack top on bottom
   to form the **prospect deck**. This allows players to influence
   the timing of when locations appear without controlling exact order.
2. **Main deck**: Each player shuffles their market deck, then draws
   [var:X] cards from it into their **main deck**. Shuffle the main
   deck. [design: X value TBD — needs playtesting.]
3. **Starting hand**: Each player draws [var:Y] cards from their main
   deck. [design: Y value TBD — needs playtesting.]

#### 3. Grid population
If the grid is not yet fully populated after seed rounds, players take
turns via **draft placement**: starting player draws a location from
their prospect deck, chooses a grid slot and orientation, then the
next player does the same. Continue until the grid is full. Events
drawn during prospect deck draws go to the player's hand.

#### 4. Policy selection
1. Each player presents three policy cards from their chosen pool.
2. Pass your three to the player on your left; that player takes one and returns the other two.
3. Once all players have returned the unchosen policies, pick one more policy from the returned pool.

Each player therefore starts the game with two policies. These policies are outside of the seeding deck size and rarity limits.

### Main Phase

Each player starts the Main Phase with:
- Their starting hand (drawn from main deck during deck construction)
- Their prospect deck (locations, face-down)
- Their market deck (remaining seeding deck cards, face-down)
- Their main deck (seeded during deck construction, face-down)
- Their two selected policies (active)
- [var:starting_gold:10] gold

## Decks

Each player has four personal decks:

| Deck | Contents | Source | Purpose |
|------|----------|--------|---------|
| **Seeding deck** | Full [var:seeding_deck_size:40]-card collection | Pre-game | Drawn through during seed rounds; split into the decks below |
| **Prospect deck** | Locations | Extracted from market deck after seeding | Populates and replenishes grid locations |
| **Market deck** | Units, items, events (undrawn cards) | Seeding deck remainder after deck construction | Purchasable cards in the market |
| **Main deck** | Units, items, events (drawn cards) | Drawn from market deck during deck construction; later refilled from discard pile | Personal draw source during player turns |
| **Discard pile** | Played, killed, completed cards | During play | Shuffled into main deck when main deck is empty |

#### The Grid

The field is a shared 2D grid of size (players + [var:grid_padding:2]) x (players + [var:grid_padding:2]).
The grid must be fully populated with locations at all times — there
are no empty slots.

#### Location borders

Each location card has four edges (N/S/E/W). Each edge is either
**open** or **blocked**. A unit cannot move between two adjacent
locations if either facing edge is blocked.

[design: Cards or unit abilities may allow movement through a single
blocked edge, but never through two (both edges blocked).]

Location orientation matters — when placing a location the player
chooses its rotation. Rotation of existing locations is not a core
action; it is provided by specific card effects (unit actions, events).

#### Populating locations

**Initial population:** During seed rounds, stolen locations are placed
on the grid immediately by the stealing player. After all seed rounds,
if the grid is not fully populated, players take turns via **draft
placement** from their prospect decks until the grid is full (see
Seeding Phase, step 3).

**Replacement:** When a location is removed from the grid (e.g. mission
completed, razed), the active player immediately draws from their
prospect deck to replace it in the same slot, choosing orientation.

#### Zones

- **Hand** — cards held by the player. Maximum hand size: [var:max_hand_size:7]. Cards exceeding the limit at end of turn must be discarded.
- **HQ** — the player's staging area (off-grid). Units and items enter play here when deployed from hand.
- **Grid** — shared 2D field containing all active locations. Units move between locations on the grid.
- **Active trap area** — face-down trap events. Targets are indicated by matching tokens. Visible to all players but contents hidden.
- **Scoring area** — completed mission locations are placed here. Worth their printed VP.
- **Discard pile** — cards removed from play. Shuffled to form the main deck when the main deck is empty.
- **Removed from game** — cards that are permanently removed. They do not cycle back into any deck.

#### Player turn

At the start of their turn the player:
1. Receives [var:turn_gold_income:1] gold.
2. Draws [var:turn_card_draw:1] card from their main deck.

Each player has [var:action_points_per_turn:3] **action points (AP)** per turn. AP can be spent in any order on the following actions:

| Action | AP Cost | Description |
|--------|---------|-------------|
| Deploy | 1 | Play a unit or item from hand to HQ. Pay the card's gold cost. |
| Buy | 0 | Purchase a card from the market. Pay its gold cost. Card goes to hand. |
| Activate | varies | Use an action printed on a unit or item. AP cost is printed on the card. |
| Draw | 1 | Draw a card from your main deck. |
| Enter | 1 | Move a unit from HQ to any edge slot on the grid. The location's edge facing the grid boundary must be open. |
| Move | 1 | Move a unit to an orthogonally adjacent location. Both facing edges must be open (see Location borders). |
| Play Event | 1 | Play an event card from hand. Instants resolve immediately; passives enter play; traps go face-down to your active trap area. |
| Equip | 1 | Attach an item to a unit, or trade an item between two units at the same location (or both at HQ). |
| Destroy | 1 | Remove a card from your hand from the game permanently. |
| Raze | [var:raze_ap_cost:3] | Your unit at a location destroys it. No other units may be present. The unit and location are discarded. The active player draws a new location from their prospect deck and places it in the same slot. |

A player may pass any remaining AP to end their turn early.

> See [Market and Economy Rules](market.md) for details on the Buy action.


## Card Types
### Units
Based on historical figures.
Stats (for example; strength, cunning, charisma).
Any stats not listed on the card are treated as [var:default_stat:5].
Attributes (for example: Scientist, Politician, Engineer, Warrior, Spiritual)
Actions: Units can have various actions that players can activate.

#### Unit status
- **Injured**: The unit is returned to its owner's HQ. Any equipped items are dropped at the unit's last location (any player's unit there may pick them up via Equip).
- **Killed**: The unit is moved to its owner's discard pile. Any equipped items are dropped at the unit's last location.

### Locations
Locations are placed on the grid during seeding (stolen locations are
placed immediately; remaining locations via draft placement to fill
the grid). During play, removed locations are replaced from the
player's **prospect deck**. Each location has four edges (N/S/E/W)
that are either open or blocked, controlling movement between adjacent
slots.

#### Missions
Main source of VP's.
A player completes a mission as soon as they fulfill all the
requirements printed on the card. Completion is checked continuously —
if an opponent's actions cause you to no longer meet the requirements
(e.g. your unit is killed), the mission is stalled until requirements
are met again.

Upon completion:
1. The location is moved to the completing player's **scoring area** (worth its printed VP).
2. All units and items at that location are moved to the **completing player's discard pile** (regardless of original ownership).
3. The active player draws a replacement location from their prospect deck and places it in the vacated slot.

#### Passive effects
Locations can grant ongoing bonuses to units present at that location.
Example: "While a unit with the Warrior attribute is here: +1 strength to all your units at this location."

### Items
Can be equipped by units or stored in locations.
Equipped items are dropped when a unit is injured and remain at the location.

### Events
Cards that produce a wide range of effects. Events are part of the
**market deck** and **main deck** (distributed during seeding like
other non-location cards). Playing any event from hand costs 1 AP.

- **Instant**: One-time effects resolved immediately upon playing. Discarded after resolution.
- **Passive**: Ongoing or timed effects that remain active for a printed
  duration (e.g. "for X turns"). Discarded when the duration expires.
- **Trap**: Played face-down into the player's **active trap area**.
  If the trap has a target (location, unit, item), the player places a
  matching token on the target. All players can see the face-down trap
  and its target token, but not the card itself. The owner manually
  chooses when to trigger the trap (if the printed condition is met).
  Discarded to owner's discard pile after resolution.

[design: Events no longer have special draw handling during market
population — they are regular market cards. The event draw mechanic
in market.md may need revisiting.]

### Policies
Static global modifiers. Selected at start via the Policy selection
draft (do not count against seeding deck limits).

## Rarity
Four tiers: **Common**, **Uncommon**, **Epic**, **Legendary**.

Rarity affects deck-building limits and pack distribution only. It has
no direct effect on gameplay mechanics or card cost — a common can be
more expensive or powerful than a legendary.

- Legendary: max [var:max_legendary:8] per seeding deck
- Epic: max [var:max_epic:24] per seeding deck
- Uncommon: no cap
- Common: no cap

## Keyword System
- Static: Passive effects.

- Triggered: Effect is triggered when condition is fulfilled.

## Economy
- Each player begins with [var:starting_gold:10] gold.
- At the start of each turn the active player receives [var:turn_gold_income:1] gold.
- **Card costs are printed on the cards** and are independent of rarity;
  a common may cost more than a legendary or vice versa.
  Rarity affects deck-building limits but not gold price.
- Gold is used to purchase cards in the market, deploy cards, pay for
  ability costs, and satisfy certain policy effects.
- Additional gold can be earned through mission rewards and policy effects.

> See [Market and Economy Rules](market.md) for full details on how the
> shop works, optional variants, and policy interactions.

## Variants
### Baseline Variant (Default)
- Players: 2+

#### Seeding
- Seeding deck size: 40
- Rarity caps on seeding deck: 8 legendary, 24 epic (applied per-deck)
- Seed round draw: 10 cards (8 to market deck, 2 to middle area)
- Steal: pick until middle area is empty; locations placed on grid
- Main deck seeded from market deck: [var:X] cards (TBD)
- Starting hand drawn from main deck: [var:Y] cards (TBD)
- Prospect deck: locations extracted from market deck, split into top/bottom halves

#### Main Phase
- Grid size: (players + 2) x (players + 2)
- Action points per turn: 3
- Hand size limit: 7
- Raze cost: 3 AP
- Turn limit: 20 rounds
- VP threshold: 50
- Victory condition: See Core Architecture.

#### Starting Resources
- 10 gold
- 1 gold income per turn
