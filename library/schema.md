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
