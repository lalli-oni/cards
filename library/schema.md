# Card Library Schema

Defines the CSV column structure for each card type. The build script
validates cards against these schemas when generating JSON.

## Shared Columns

Every card type includes these columns:

| Column   | Type   | Required | Description |
|----------|--------|----------|-------------|
| id       | string | yes      | Unique identifier. Kebab-case of card name (e.g. `cleopatra`, `nikola-tesla`) |
| name     | string | yes      | Display name |
| set      | string | yes      | Set identifier (e.g. `baseline`) |
| rarity   | enum   | yes      | `common`, `uncommon`, `epic`, `legendary` |
| cost     | string | yes      | Gold cost to deploy/play. Multiple costs separated by `\|` (player pays one) |
| text     | string | no       | Card text — rules text, abilities, effects |
| flavor   | string | no       | Flavor text |
| keywords | string | no       | Semicolon-separated keywords (e.g. `Ambush;Lethal`) |

## Units

| Column     | Type   | Required | Description |
|------------|--------|----------|-------------|
| strength   | int    | no       | Defaults to `[var:default_stat:5]` if omitted |
| cunning    | int    | no       | Defaults to `[var:default_stat:5]` if omitted |
| charisma   | int    | no       | Defaults to `[var:default_stat:5]` if omitted |
| attributes | string | no       | Semicolon-separated (e.g. `Scientist;Engineer`) |
| actions    | string | no       | Semicolon-separated action definitions. Format: `name:ap_cost:effect` |

## Locations

| Column       | Type   | Required | Description |
|--------------|--------|----------|-------------|
| requirements | string | no       | Mission requirements. Semicolon-separated atomic checks, AND'd. See Requirement Checks below. |
| rewards      | string | no       | Mission rewards. Format: `Nvp` (e.g. `5vp`). A location with both `requirements` and `rewards` is a mission location. |
| passive      | string | no       | Passive effect text |
| edges   | string | no       | Blocked edges, semicolon-separated (`N`, `S`, `E`, `W`). Unlisted edges are open. Empty = all open. |
| actions | string | no       | Semicolon-separated action definitions. Format: `name:ap_cost:effect`. Usable by any player with a unit at this location. |

## Items

| Column  | Type   | Required | Description |
|---------|--------|----------|-------------|
| equip   | string | no       | Effect when equipped by a unit |
| stored  | string | no       | Effect when stored at a location |
| actions | string | no       | Semicolon-separated action definitions. Format: `name:ap_cost:effect` |

## Events

| Column   | Type   | Required | Description |
|----------|--------|----------|-------------|
| subtype  | enum   | yes      | `instant`, `passive`, `trap` |
| duration | int    | no       | Number of turns (for `passive` subtype) |
| trigger  | string | no       | Trigger condition (for `trap` subtype) |

## Policies

| Column         | Type   | Required | Description |
|----------------|--------|----------|-------------|
| effect         | string | yes      | Passive global modifier text |
| seeding_effect | string | no       | Effect that applies during the seeding phase |
| actions        | string | no       | Semicolon-separated action definitions. Format: `name:ap_cost:effect` |

## Requirement Checks

Mission requirements use semicolon-separated atomic checks, all AND'd together.

| Check type | Format | Example | Meaning |
|------------|--------|---------|---------|
| Attribute count | `attribute_N` | `scientist_2` | ≥ 2 units with the Scientist attribute |
| Stat threshold | `stat_N` | `strength_15` | Sum of stat across ALL friendly units ≥ 15 |
| Unit count | `units_N` | `units_3` | ≥ 3 friendly units |

Combined example: `warrior_1;strength_15` → have at least 1 Warrior AND combined strength ≥ 15 across all friendly units.

Stat checks always sum across all friendly units at the location — the attribute check and stat check are independent.

## Delimiter Conventions

- **Semicolons** (`;`) separate list items within a single field (attributes, keywords, actions, requirements)
- **Pipes** (`|`) separate alternative costs
- **Colons** (`:`) separate action components (name:ap_cost:effect)

## Effect DSL

A structured mini-language for encoding card effects as data. Used in the
`effect` component of action definitions (`name:ap_cost:effect`) and in
instant event effects. The engine interprets the DSL — new cards are data,
not code.

### Grammar

```
expression  = effect ( "+" effect )*          -- compound (parallel)
effect      = step ( ">" step )*              -- chain (sequential / pipe)
step        = primitive consequence?
primitive   = verb target? value? modifier*
verb        = IDENT ( "." IDENT )?            -- e.g. contest.strength, buff.charisma
target      = "(" selector ")"
selector    = token ( "+" token )*            -- composable filters
token       = IDENT value?                    -- e.g. friendly, enemy[2], deck
value       = "[" NUMBER "]"                  -- e.g. [3], [-1], [0]
modifier    = "~" IDENT                       -- e.g. ~turn, ~round, ~ignore_blocked
consequence = ">" effect ( ":" effect )?      -- ternary: win_effect : lose_effect
```

### Operators

| Operator | Context | Meaning |
|----------|---------|---------|
| `.`      | verb    | Verb parameter — stat name, subtype. `contest.strength`, `buff.charisma` |
| `()`     | target  | Who/what is affected. Encloses a selector expression. |
| `+` inside `()` | target | Composable filter. Each token narrows the selection: `(all + friendly + here)` |
| `+` outside `()` | effect | Compound — both effects happen in parallel. `gold[1] + move(self)` |
| `[]`     | value   | Numeric parameter. Inside `()` = target count. Outside = effect value. |
| `>`      | chain   | Pipe/sequence — output of left feeds into right. `reveal(deck)[3] > pick[1]` |
| `~`      | modifier | Modifies preceding effect. Duration (`~turn`, `~round`) or rule flag (`~ignore_blocked`). |
| `:`      | consequence | Separates win/lose effects (ternary). `> win_effect : lose_effect` |

### Verbs

Core primitives the engine implements. New cards compose these — no per-card code.

| Verb | Value meaning | Description |
|------|---------------|-------------|
| `gold` | amount | Gain (positive) or lose (negative) gold. `gold[3]`, `gold[-2]` |
| `vp` | amount | Gain victory points. `vp[1]` |
| `draw` | count | Draw cards from your deck. `draw[2]`. Implicit `[1]`. |
| `buy` | cost override | Buy a card from market. `buy(item)[0]` = buy item for free. `buy[-1]` = 1 gold discount on anything. |
| `move` | distance | Move a unit. `move(self)[2]` = 2 spaces. Implicit `[1]`. |
| `reveal` | count | Reveal cards from a zone. `reveal(deck)[3]`, `reveal(opponent + hand)` |
| `pick` | count | Player picks N from previously revealed cards (used after `>` pipe from `reveal`). `reveal(deck)[3] > pick[1]` |
| `buff.STAT` | amount | Temporary stat increase. Requires `~duration`. `buff.strength(all + friendly)[2]~turn` |
| `contest.STAT` | bonus | Stat contest using named stat. Value = attacker bonus. `contest.strength[3]` = +3 bonus. |
| `injure` | — | Injure target unit. `injure(enemy)` |
| `kill` | — | Kill target unit. `kill(self)` |
| `control` | — | Take control of target. Requires `~duration`. `control(target)~round` |
| `raze` | — | Remove a location from the grid. `raze(location)` |
| `to` | — | Move result to a zone (used after `>` pipe). `raze(location) > to(hq)` |
| `remove` | — | Remove card from play. `remove(location)` |

### Targets

Targets are composable selectors inside `()`. Each `+` token narrows the selection.
Player choice is implied when multiple valid targets exist.

#### Entity tokens

| Token | Meaning |
|-------|---------|
| `self` | The unit performing the action |
| `target` | The previously targeted entity (back-reference in chains) |
| `enemy` | Enemy unit |
| `friendly` | Friendly unit (not self) |
| `all` | All matching entities (no player choice) |
| `random` | Random selection (no player choice) |

#### Scope tokens

| Token | Meaning |
|-------|---------|
| `here` | Same location as acting unit (default for most effects — can be omitted) |
| `adjacent` | Orthogonally adjacent location |

#### Zone tokens

| Token | Meaning |
|-------|---------|
| `deck` | Your main deck |
| `hand` | Your hand |
| `hq` | Your HQ |
| `opponent` | Scopes to opponent. Combine: `(opponent + hand)`, `(opponent + deck)` |
| `market` | The shared market |
| `location` | A location on the grid |

#### Target count

`[N]` inside parentheses specifies how many targets: `(friendly[2])` = up to 2 friendly units.
Omitting count implies 1 for targeted effects, or all for `(all + ...)`.

### Modifiers

Attached to the preceding effect with `~` (no space). Multiple modifiers
can chain: `move(friendly)~ignore_blocked~no_ap`.

#### Duration modifiers

| Modifier | Meaning |
|----------|---------|
| `~turn` | Until end of current turn |
| `~round` | Until end of round (both players have passed) |
| `~N` | For N turns (e.g. `~3` for 3 turns) |

#### Rule modifiers

| Modifier | Meaning |
|----------|---------|
| `~ignore_blocked` | Ignore blocked edges when moving |

### Contests

Stat contests use the `contest.STAT` verb. Resolution follows [Stat Contests](../rules/stat-contests.md):
each unit rolls d6, attack power = stat + d6 + bonus, higher wins, ties go to defender.

**Default consequences** (when no `>` is specified):
- `contest.strength` → loser is injured (killed if winner's power ≥ 2× loser's)
- All other stats → no default consequence (must specify via `>`)

**Custom consequences** use ternary syntax after `>`:
```
contest.charisma(enemy + adjacent) > control(target)~round
```
Win consequence only — no lose effect.

```
contest.strength(enemy)[3] > gold[3] : gold[-2]
```
Win: gain 3 gold. Lose: lose 2 gold. The `[3]` on contest is the attacker bonus.

### Examples

Complete action definitions (`name:ap_cost:effect`):

| Card | Action definition |
|------|-------------------|
| Leonardo da Vinci | `design:1:draw[2]` |
| Mansa Musa | `pilgrimage:2:gold[5]` |
| Miyamoto Musashi | `duel:1:contest.strength(enemy)` |
| Cleopatra | `diplomacy:1:contest.charisma(enemy + adjacent) > control(target)~round` |
| Hannibal Barca | `flank:2:contest.strength(enemy)[3]` |
| Joan of Arc | `rally:1:buff.strength(all + friendly)[2]~turn` |
| Hypatia | `lecture:1:buff.cunning(friendly)[2]~turn` |
| Nefertiti | `inspire:1:buff.charisma(all + friendly)[2]~turn` |
| Marco Polo | `trade-route:1:move(self) + gold[1]` |
| Ibn Battuta | `wander:1:move(self) + gold[1]` |
| Sun Tzu | `stratagem:1:move(enemy)` |
| Harriet Tubman | `underground:1:move(friendly)~ignore_blocked` |
| Alexander the Great | `march:1:move(self) + contest.strength(enemy)` |
| Ada Lovelace | `analyze:1:reveal(deck)[3] > pick[1]` |
| Galileo Galilei | `observe:1:reveal(opponent + hand)` |
| Nikola Tesla | `invent:2:buy(item)[0]` |
| Genghis Khan | `conquer:3:raze(location) > to(hq)` |
| Ramesses II | `monument:2:vp[1] + kill(self)` |

Instant event effects (standalone, no name/cost wrapper):

| Card | Effect |
|------|--------|
| Harvest Festival | `gold[3]` |
| Earthquake | `injure(all + here) + remove(location)` |
| Forced March | `move(friendly[2])` |
