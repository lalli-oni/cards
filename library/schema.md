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
| rarity   | enum   | yes      | `common`, `uncommon`, `rare`, `epic`, `legendary` |
| cost     | string | yes      | Gold cost to deploy/play. Multiple costs separated by `\|` (player pays one) |
| text     | string | no       | Card text — rules text, abilities, effects |
| flavor   | string | no       | Flavor text |
| keywords | string | no       | Semicolon-separated keywords (e.g. `Stealth;Fortify`) |

## Units

| Column     | Type   | Required | Description |
|------------|--------|----------|-------------|
| strength   | int    | no       | Defaults to `[var:default_stat:5]` if omitted |
| cunning    | int    | no       | Defaults to `[var:default_stat:5]` if omitted |
| charisma   | int    | no       | Defaults to `[var:default_stat:5]` if omitted |
| attributes | string | no       | Semicolon-separated (e.g. `Scientist;Engineer`) |
| actions    | string | no       | Semicolon-separated action definitions. Format: `name:ap_cost:effect` |

## Locations

| Column  | Type   | Required | Description |
|---------|--------|----------|-------------|
| mission | string | no       | Mission requirements and VP reward. Format: `requirements>vp` |
| passive | string | no       | Passive effect text |

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

| Column | Type   | Required | Description |
|--------|--------|----------|-------------|
| effect | string | yes      | Global modifier text |

## Delimiter Conventions

- **Semicolons** (`;`) separate list items within a single field (attributes, keywords, actions)
- **Pipes** (`|`) separate alternative costs
- **Colons** (`:`) separate action components (name:ap_cost:effect)
- **Greater-than** (`>`) separates mission requirements from VP reward
