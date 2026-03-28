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

All phases consist of rounds.

In each round every player gets a turn, first starting player and then going clockwise until last player ends their turn.

### Seeding Phase [var:seeding-phase]
Each player brings a **seeding deck** of [var:seeding_deck_size:60] cards (shuffled).
Each seeding deck must contain exactly [var:seeding_locations:16] **locations** and
[var:seeding_dilemmas:16] **dilemmas**; the remaining [var:seeding_other:28] cards are units, items,
and events. Rarity limits apply per deck (see Rarity). Policies are
not part of the seeding deck and do not count toward these totals.

Each player brings [var:policy_pool_size:3] policy cards (separate from the seeding
deck).

#### 1. First policy selection
Each player picks 1 policy from their pool (face-up, visible to all).

#### 2. Draft rounds
Repeat draft rounds until all players' seeding decks are empty. Each
draft round:

1. **Draw**: In turn order, each player draws [var:seed_draw:10] cards from their
   seeding deck. The last [var:seed_expose:2] drawn are placed face-up in the
   shared **Arena**. Of the remaining 8 kept cards:
   - **Locations** are placed on the grid immediately (player chooses
     slot and orientation). If the grid is full, the location goes to
     the player's prospect deck (face-down).
   - **Dilemmas** are placed face-down under a mission location on
     the grid (max [var:dilemmas_per_mission:2] per mission). If no mission has room, the
     dilemma goes to the player's prospect deck (face-down).
   - All other cards go to the player's **market deck** (face-down).
   [design: If a player has fewer cards remaining than [var:seed_draw:10], they
   draw what they can and split proportionally (round up for kept,
   remainder to Arena).]
2. **Claim**: Starting with the player holding the **starting player
   token**, players take turns claiming one card from the Arena.
   The starting player token rotates clockwise each draft round.
   Repeat until the Arena is empty.
   - Claimed **locations** must be placed on the grid immediately
     (the claiming player chooses slot and orientation). If the grid
     is already full, the claimed location goes to the player's
     prospect deck instead (face-down).
   - Claimed **dilemmas** must be placed face-down under a mission
     location on the grid (max [var:dilemmas_per_mission:2] per mission). If no mission
     has room, the dilemma goes to the player's prospect deck
     instead (face-down).
   - Other claimed cards go to the player's market deck.
   All cards in the Arena must be claimed; players continue picking
   until the Arena is empty.

#### 3. Deck construction
After all draft rounds are complete:

1. **Prospect deck**: Each player's prospect deck (locations and
   dilemmas accumulated during draft rounds) is automatically shuffled.
2. **Main deck**: Each player shuffles their market deck, then draws
   [var:main_deck_seed:10] cards from it into their **main deck**. Shuffle the main
   deck.
3. **Starting hand**: Each player draws [var:starting_hand:5] cards from their main
   deck.

#### 4. Second policy selection
Each player picks 1 more policy from their remaining pool (face-up,
visible to all). The unchosen policy is removed from the game. Each
player starts the main phase with two active policies.

### Main Phase

Each player starts the Main Phase with:
- Their starting hand (drawn from main deck during deck construction)
- Their prospect deck (locations and dilemmas, face-down)
- Their market deck (remaining seeding deck cards, face-down)
- Their main deck (seeded during deck construction, face-down)
- Their two selected policies (active)
- [var:starting_gold:10] gold

## Decks

Each player has four personal decks:

| Deck | Contents | Source | Purpose |
|------|----------|--------|---------|
| **Seeding deck** | Full [var:seeding_deck_size:60]-card collection | Pre-game | Drawn through during draft rounds; split into the decks below |
| **Prospect deck** | Locations, dilemmas | Built during seeding (locations/dilemmas go here when grid is full or no room) | Populates and replenishes grid locations; provides dilemmas for placement |
| **Market deck** | Units, items, events (undrawn cards) | Seeding deck remainder after deck construction | Purchasable cards in the market |
| **Main deck** | Units, items, events (drawn cards) | Drawn from market deck during deck construction; later refilled from discard pile | Personal draw source during player turns |
| **Discard pile** | Played, killed, completed cards | During play | Recycled into the main deck when needed (see Drawing cards) |

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

**Initial population:** During draft rounds, locations are placed on the
grid immediately — whether drawn (kept) or claimed. If the grid is
full, excess locations go to the player's prospect deck. The grid is
guaranteed to fill during draft rounds (each player brings [var:seeding_locations:16]
locations, exceeding available grid slots for all player counts).

**Replacement:** When a location is removed from the grid (e.g. mission
completed, razed), the active player draws from their prospect deck
until a location is drawn and places it in the same slot, choosing
orientation. Any dilemmas drawn this way are placed face-down under a
mission location on the grid (max [var:dilemmas_per_mission:2] per mission); if no mission
has room, the dilemma goes to the bottom of the prospect deck.

#### Zones

- **Hand** — cards held by the player. Maximum hand size: [var:max_hand_size:7]. Cards exceeding the limit at end of turn must be discarded.
- **HQ** — the player's staging area (off-grid). Units and items enter play here when deployed from hand.
- **Grid** — shared 2D field containing all active locations. Units move between locations on the grid.
- **Active trap area** — face-down trap events. Targets are indicated by matching tokens. Visible to all players but contents hidden.
- **Scoring area** — completed mission locations are placed here. Worth their printed VP.
- **Discard pile** — cards removed from play. Recycled into the main deck when needed (see Drawing cards).
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
| Enter | 1 | Move a unit from HQ to any perimeter location on the grid. The location's edge facing the grid boundary must be open (the boundary is treated as blocked). |
| Move | 1 | Move a unit to an orthogonally adjacent location (or from an edge location back to HQ — edge facing boundary must be open). Both facing edges must be open (see Location borders). |
| Play Event | 1 | Play an event card from hand. Instants resolve immediately; passives enter play; traps go face-down to your active trap area. |
| Equip | 1 | Manage items on units: attach, swap between units, or unequip (leave at location). Units and items must be at the same place (HQ or grid location). Items must be deployed to HQ before equipping — not directly from hand. |
| Destroy | 1 | Remove a card from your hand from the game permanently. |
| Attempt Mission | 1 | Initiate a mission attempt at a location where you have at least one unit. All friendly units at the location contribute to requirement checks. Dilemmas are resolved one at a time (top first). If all dilemmas are overcome, mission requirements are checked — if met, mission completes. See Missions for details. |
| Attack | 1 | Initiate combat at a location where you have at least one unit and an opponent has at least one unit. See Combat for details. |
| Raze | [var:raze_ap_cost:3] | Your unit at a location destroys it. No enemy units may be present. All friendly units at the location, the location, and any items there are discarded. The active player draws a new location from their prospect deck and places it in the same slot. |

A player may pass any remaining AP to end their turn early.

#### Drawing cards

Each deck has its own draw behavior:

- **Main deck**: The default draw source for players. When a draw is
  attempted and the main deck is empty, the **discard pile** is shuffled
  to form a new main deck, then the draw proceeds. If both are empty,
  the draw fails (no card drawn, no penalty). Start-of-turn draws, the
  Draw action, and card effects that say "draw a card" all draw from
  here unless stated otherwise.
- **Market deck**: Drawn from to populate and refill the market (see
  [Market Rules](market.md)). If the market deck is empty, the market
  slot remains empty.
- **Prospect deck**: Drawn when a grid location must be replaced. Draw
  until a location is found; dilemmas drawn along the way are placed
  under a mission (see Populating locations). If the prospect deck is
  empty, no replacement occurs.

#### Combat

> Combat is a series of **strength contests** resolved through a
> multi-unit commitment and matchup system. See
> [Stat Contests](stat-contests.md) for the general contest mechanic.

Combat is initiated by the **Attack** action (1 AP). The attacker must
have at least one unit at the location and at least one enemy unit must
be present.

**Combat flow:**

1. **Commit (attacker)**: The attacker chooses which of their units at
   the location participate. Must commit at least one.
2. **Commit (defender)**: All defender units at the location are
   committed automatically — the defender cannot hold units back.
3. **Roll**: Each side rolls one d6 per committed unit. Each unit's
   **attack power** = printed strength + d6 roll.
4. **Matchup (defender assigns)**: The defender pairs units into 1v1
   matchups. The number of pairs equals the smaller side's committed
   count. The side with more units chooses which of their excess units
   sit out (decided after seeing all rolls).
5. **Resolve**: Each pair resolves independently:
   - Higher attack power wins. **Tie = defender wins.**
   - Loser is **injured** (see Unit status). Items are dropped at the
     location.
   - If the winner's attack power is [var:combat_kill_ratio:2]x or more the loser's
     attack power, the loser is **killed** instead (see Unit status).
     Items are dropped at the location.
6. **Next round or end**: After all pairs resolve, if both sides still
   have surviving (non-injured, non-killed) units at the location,
   combat continues — return to step 3 (re-roll all surviving units).
   Either side may **retreat** before the next round begins: all
   retreating units return to their owner's HQ. If one side has no
   remaining units (or retreats entirely), combat ends.

**Notes:**
- The attacker controls commitment size; the defender controls matchup
  assignments. This creates asymmetric tactical decisions.
- Units that sat out in a round rejoin the pool for the next round's
  roll and matchup.
- A player may attack a location where multiple opponents have units.
  Each opponent's units are committed separately and the attacker
  resolves combat against each opponent in turn (attacker chooses
  order). Surviving attacker units carry over between resolutions.

> See [Market and Economy Rules](market.md) for details on the Buy action.


## Card Types
### Units
Based on historical figures.
Stats (for example; strength, cunning, charisma). Stats are open-ended
— any stat printed on a card can be referenced by game mechanics.
Any stats not listed on the card are treated as [var:default_stat:5].
See [Stat Contests](stat-contests.md) for how stats are used in 1v1
contest resolution.
Attributes (for example: Scientist, Politician, Engineer, Warrior, Spiritual)
Actions: Units can have various actions that players can activate.

#### Unit status
- **Injured**: The unit remains where it is but suffers the following
  effects until healed:
  - **-[var:injury_stat_penalty:1] to all stats**
  - **+[var:injury_move_penalty:1] AP cost to Move** (Move costs 2 AP instead of 1)
  - An already-injured unit that is injured again is **killed** instead.
  - Equipped items stay on the unit (items are only dropped when a unit
    is killed, or by specific card effects).
  - **Healing**: An injured unit at HQ at the start of its owner's turn
    is healed automatically (injury removed). Units with the Heal
    ability (e.g. doctors, nurses) can heal an injured unit at the same
    location for 1 AP.
- **Killed**: The unit is moved to its owner's discard pile. Any
  equipped items are dropped at the unit's last location (any player's
  unit there may pick them up via Equip).
- **Controlled**: A unit under another player's control. Card effects
  can grant a player temporary control of an enemy unit for a stated
  duration. Duration tracking follows the same token pattern as
  passive events where applicable.
  - The controlled unit counts as a **friendly unit** of the
    controller for all purposes (actions, mission attempts, stat
    checks, etc.).
  - The controller may use the controlled unit's actions, move it,
    and manage its equipment (equip, unequip, swap).
  - **Leaving the board**: Any effect that would move a controlled
    unit off the board instead returns the unit to its **owner's HQ**.
    Control ends immediately. Equipped items are dropped at the unit's
    last location before it returns. This applies to:
    - killed, discarded, sent to hand, mission completion, or
      removed from game
  - **When control ends naturally** (duration expires): the unit
    stays where it is. Control is returned to the original owner.
  - Injuries sustained while controlled persist after control ends.
  - A unit that is already controlled **cannot be controlled** by
    another player. The existing control must end first.
  - [design: A controlled unit that would be killed returns to its
    owner's HQ alive. This is intentional — the owner should not
    permanently lose a unit to an opponent's control effect.]

### Locations
Locations are placed on the grid during seeding (both drawn and claimed
locations are placed immediately; excess goes to prospect deck). During play, removed locations are replaced from the
player's **prospect deck**. Each location has four edges (N/S/E/W)
that are either open or blocked, controlling movement between adjacent
slots.

Not all locations are missions. **Non-mission locations** have no VP
reward but can affect the grid in various ways or grant bonuses to
players who fulfill their printed requirements (these are not mission
requirements — they do not trigger completion or scoring).

#### Missions
Main source of VP's. A player must spend 1 AP to **attempt** a
mission at a location where they have a unit. The attempt proceeds
as follows:

1. **Dilemma resolution**: If there are dilemmas face-down under the
   location, the top dilemma is revealed. Requirements are checked
   against **all friendly units at the location**:
   - **Stat checks** sum the relevant stat across all friendly units
     (e.g. "Requires 12 strength" — add up all friendly units'
     strength).
   - **Attribute checks** pass if at least one friendly unit has the
     required attribute (e.g. "Requires a Scientist").
   - **Match-one checks** list multiple conditions separated by OR —
     meeting any one is sufficient.
   - A dilemma may combine multiple requirements (all must be met
     unless stated otherwise).
   - **Overcome**: The dilemma is removed from the game. If another
     dilemma remains, it is revealed immediately and must also be
     resolved.
   - **Failed**: The dilemma's printed consequence takes effect. When
     a consequence targets a unit (e.g. "a unit is injured"), the
     attempting player chooses which of their units at the location is
     affected, unless the dilemma specifies a target. The dilemma
     stays face-down under the location (must be faced again on a
     future attempt). The attempt ends.
2. **Completion check**: After all dilemmas are overcome (or if there
   were none), the mission's requirements are checked (using the same
   stat/attribute rules as dilemmas). If met, the mission completes.
   If not met, the attempt ends with no penalty.

Upon completion:
1. The location is moved to the completing player's **scoring area** (worth its printed VP).
2. All units and items at that location are moved to the **completing player's discard pile** (regardless of original ownership).
3. The active player draws a replacement location from their prospect deck and places it in the vacated slot.

#### Passive effects
Locations can grant ongoing bonuses to units present at that location.
Example: "While a unit with the Warrior attribute is here: +1 strength to all your units at this location."

### Dilemmas
Inspired by the Star Trek CCG dilemma system. Dilemmas are placed
face-down under **mission locations** on the grid (max [var:dilemmas_per_mission:2] per
mission). They add challenges that players must overcome before
completing a mission, and can award VP to the player who solves them.

Dilemmas are part of the **seeding deck** and follow the same
draw/claim flow as other cards. Dilemmas never enter a player's hand
or market deck — they are always placed under a mission location or
sent to the player's prospect deck. See Seeding Phase for details.

Dilemmas may only be **common** or **uncommon** rarity. They do not
count toward the legendary/epic caps.

Any player can attempt to solve dilemmas at any mission — there is
no mission ownership. Players may strategically place dilemmas on
missions they intend to complete (to earn the dilemma's VP) or on
missions they want to make harder for opponents.

Each dilemma card specifies:
- **Requirements** to overcome — stat checks (summed across all
  friendly units at the location), attribute checks (at least one
  friendly unit must have it), or match-one lists. A dilemma may
  combine multiple requirements.
- **Reward** for overcoming (VP, gold, etc.)
- **Consequence** for failing (unit injured, gold lost, etc.). When a
  consequence targets a unit, the attempting player chooses which of
  their units is affected, unless the dilemma specifies a target.

Dilemmas are revealed and resolved during the **Attempt Mission**
action. See Missions for the full resolution sequence.

### Items
Items are equipped to units via the Equip action. Unequipped items sit
at a location and can be picked up by any player's unit there. Items
end up at locations when unequipped via Equip, or dropped by a killed
unit.

#### Equipment slots
Each item occupies a slot on the unit. A unit has the following slots:

| Slot | Capacity |
|------|----------|
| Hand | 2 (a 2-handed item uses both) |
| Head | 1 |
| Torso | 1 |
| Legs | 1 |
| Feet | 1 |
| Vehicle | 1 |

Each item card prints which slot it occupies.

#### Item types
Items have a type used for targeting by other cards and abilities.
Each item has one type.

| Type | Description |
|------|-------------|
| Weapon | Offensive equipment (sword, rifle, bow) |
| Armor | Protective wearables (helmet, vest, boots) |
| Tool | Utility items (toolkit, lockpick, binoculars) |
| Vehicle | Transport (helicopter, horse, car) |
| Accessory | Miscellaneous (crown, goggles, compass) |

### Events
Cards that produce a wide range of effects. Events are part of the
**market deck** and **main deck** (distributed during seeding like
other non-location cards). Playing any event from hand costs 1 AP.

- **Instant**: One-time effects resolved immediately upon playing. Discarded after resolution.
- **Passive**: Ongoing effects with a printed duration (e.g. "2 turns").
  When played, place duration tokens on the card equal to the printed
  number. At the end of each of the owner's turns, remove one token.
  When the last token is removed, discard the card. (A "2 turn" passive
  is active for the turn it is played and the owner's next turn.)
- **Trap**: Played face-down into the player's **active trap area**.
  If the trap has a target (location, unit, item), the player places a
  matching token on the target. All players can see the face-down trap
  and its target token, but not the card itself. When the trap's printed
  condition is triggered, the owner may activate it on **any player's
  turn** (including opponents'). Activating a trap does not cost AP —
  it interrupts the current action's resolution. Traps are the only
  card type that can interrupt an opponent's turn. Discarded to owner's
  discard pile after resolution.

[design: See ideas.md for discussion on event draw mechanic balance.]

### Policies
Static global modifiers selected during the Seeding Phase. Each policy
can have a passive effect, a seeding effect, and/or a policy action.
Policies do not count against seeding deck limits.

> See [Policy Rules](policies.md) for full details and examples.

## Rarity
Four tiers: **Common**, **Uncommon**, **Epic**, **Legendary**.

Rarity affects deck-building limits and pack distribution only. It has
no direct effect on gameplay mechanics or card cost — a common can be
more expensive or powerful than a legendary.

- Legendary: max [var:max_legendary:8] per seeding deck
- Epic: max [var:max_epic:16] per seeding deck
- Uncommon: no cap
- Common: no cap

## Keyword System

Keywords are shorthand abilities referenced by name (bolded text or
icons) on cards. Each keyword has a fixed definition in the glossary
below. Some keywords have variable values (e.g. Shield X) where X
differs per card.

### Timing
- **Static**: Always active while the card is in play.
- **Triggered**: Fires automatically when a specific condition is met.
- **Activated**: Initiated by player.

### Keyword Glossary

#### Unit keywords
| Keyword | Timing | Definition |
|---------|--------|------------|
| Commander | Static | Friendly units at the same location get +X to all stats |
| Ambush | Triggered | When this unit enters a location with an enemy unit, one enemy unit there is injured |
| Untouchable | Static | This unit cannot be targeted by the Attack action and is not committed to combat as a defender |
| Duelist | Static | When this unit is in combat, the matchup it is assigned to is resolved in isolation — no other units' keywords or effects apply to it |
| Lethal | Static | When this unit wins combat, the loser is killed instead of injured (regardless of attack power ratio) |
| Resolute | Static | This unit wins ties when attacking |
| Taunt | Static | Enemy units at this location must target this unit when attacking. If multiple friendly units have Taunt, the attacker chooses among them |
| Heal | Activated (1 AP) | Remove the injured status from a friendly unit at the same location |

#### Equipment keywords
| Keyword | Timing | Definition |
|---------|--------|------------|
| Flying | Static | Equipped unit ignores blocked edges when moving |
| Shield | Triggered | Prevents the equipped unit from being injured or killed once. Equipment is discarded after use |
| Heavy | Static | Equipped unit cannot use the Move action more than once per turn |

#### Location keywords
| Keyword | Timing | Definition |
|---------|--------|------------|
| Radiated | Static | Units at this location get -X to all stats while present |
| Fortified | Static | Defender units at this location get +X to strength when calculating attack power |

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
- Seeding deck size: 60 (16 locations, 16 dilemmas, 28 other)
- Rarity caps on seeding deck: [var:max_legendary:8] legendary, [var:max_epic:16] epic (applied per-deck)
- Draft round draw: 10 cards (last 2 to Arena, 8 kept)
- Claim: pick until Arena is empty; locations placed on grid; starting player token rotates each round
- Dilemmas per location: 2
- Main deck seeded from market deck: 10 cards
- Starting hand drawn from main deck: 5 cards
- Prospect deck: locations/dilemmas accumulated during seeding draft rounds, auto-shuffled at deck construction

#### Main Phase
- Grid size: (players + 2) x (players + 2)
- Action points per turn: 3
- Hand size limit: 7
- Raze cost: 3 AP
- Combat kill threshold: 2x attack power
- Combat die: d6
- Injury stat penalty: -1 to all stats
- Injury movement penalty: +1 AP to Move
- Turn limit: 20 rounds
- VP threshold: 50
- Victory condition: See Core Architecture.

#### Starting Resources
- 10 gold
- 1 gold income per turn
