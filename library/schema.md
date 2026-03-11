# Card Library Schema

Defines the CSV column structure for each card type. The build script
validates cards against these schemas when generating JSON.

## Shared Columns

Every card type includes these columns:

| Column   | Type   | Required | Description |
|----------|--------|----------|-------------|
| id       | string | yes      | Unique identifier. Format: `{set}-{type_prefix}-{number}` (e.g. `core-u001`) |
| name     | string | yes      | Display name |
| set      | string | yes      | Set identifier (e.g. `core`) |
| rarity   | enum   | yes      | `common`, `uncommon`, `rare`, `epic`, `legendary` |
| cost     | string | yes      | Gold cost to deploy/play. Multiple costs separated by `\|` (player pays one) |
| text     | string | no       | Card text — rules text, abilities, effects |
| flavor   | string | no       | Flavor text |
| keywords | string | no       | Semicolon-separated keywords (e.g. `Stealth;Fortify`) |

## Units

Prefix: `u`

| Column     | Type   | Required | Description |
|------------|--------|----------|-------------|
| strength   | int    | no       | Defaults to `[var:5]` if omitted |
| cunning    | int    | no       | Defaults to `[var:5]` if omitted |
| charisma   | int    | no       | Defaults to `[var:5]` if omitted |
| attributes | string | no       | Semicolon-separated (e.g. `Scientist;Engineer`) |
| actions    | string | no       | Semicolon-separated action definitions. Format: `name:ap_cost:effect` |

## Locations

Prefix: `l`

| Column  | Type   | Required | Description |
|---------|--------|----------|-------------|
| mission | string | no       | Mission requirements and VP reward. Format: `requirements>vp` |
| passive | string | no       | Passive effect text |

## Items

Prefix: `i`

| Column  | Type   | Required | Description |
|---------|--------|----------|-------------|
| equip   | string | no       | Effect when equipped by a unit |
| stored  | string | no       | Effect when stored at a location |
| actions | string | no       | Semicolon-separated action definitions. Format: `name:ap_cost:effect` |

## Events

Prefix: `e`

| Column   | Type   | Required | Description |
|----------|--------|----------|-------------|
| subtype  | enum   | yes      | `instant`, `passive`, `trap` |
| duration | int    | no       | Number of turns (for `passive` subtype) |
| trigger  | string | no       | Trigger condition (for `trap` subtype) |

## Policies

Prefix: `p`

| Column | Type   | Required | Description |
|--------|--------|----------|-------------|
| effect | string | yes      | Global modifier text |

## Delimiter Conventions

- **Semicolons** (`;`) separate list items within a single field (attributes, keywords, actions)
- **Pipes** (`|`) separate alternative costs
- **Colons** (`:`) separate action components (name:ap_cost:effect)
- **Greater-than** (`>`) separates mission requirements from VP reward
