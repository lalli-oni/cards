# Card Game Project

This repository houses a card game [name pending] with the following aspects:

1. Completely free. Only monetization is through donations, if I can be bothered.
2. Collectible. New card packs will be released and cards gained through packs.
3. Any number of players. Single player and multiplayer with a cap of 8 players [subject to change].
4. Variants. The game allows for any number of variants. The default variant called `Baseline` will give us a starting point for others. Examples of future variants: `Fair` (optimizes fairness between players with different card collections), `Chaos` (more RNG oriented, opens for stronger synergies), `Competitive` (less RNG oriented, more deterministic, presses player skills), `Cooperative` (players play towards a common goal)
5. Challenging. Complex in ways that challenges players. Like reacting to changing conditions or spotting valuable synergies.
6. De-coupled. The rules are as de-coupled from the engine as much as possible (among other things allowing maximum customization of rules through variants). Clients and test runner are also de-coupled from the engine and import it as a dependency.


## Getting Started

### Prerequisites
- [Bun](https://bun.sh) — runtime for build scripts
- [VisiData](https://www.visidata.org) — terminal spreadsheet for editing CSVs (`brew install visidata`)
- [Nushell](https://www.nushell.sh) — structured data shell for querying cards (optional, used for `/card-query` skill)

### Editing Cards

Cards live as CSV files in `library/sets/{set_name}/`. One file per card type: `units.csv`, `locations.csv`, `items.csv`, `events.csv`, `policies.csv`.

**VisiData** is the recommended editor for card CSVs. It gives you a full spreadsheet UI in the terminal with sorting, filtering, and inline editing — without leaving your workflow.

```sh
# Open a card file for editing
vd library/sets/core/units.csv

# Open all core set files at once (tab between sheets)
vd library/sets/core/*.csv
```

Key VisiData commands:
- `e` — edit the current cell
- `arrows` / `hjkl` — navigate
- `[` / `]` — sort ascending / descending by current column
- `|` — filter rows by regex on current column
- `a` — add a new row
- `d` — delete current row
- `Ctrl+S` — save changes back to CSV
- `q` — quit current sheet / exit

VisiData is best for: adding or editing individual cards, quick bulk changes, reviewing a set's content. For large batch imports, use Numbers/Excel and re-export as CSV.

### Building the Library

After editing CSVs, build to JSON for the engine:

```sh
bun library/build.ts          # build all sets
bun library/build.ts core     # build a specific set
```

The build script validates required fields and enum values. Fix any reported errors before committing.

### Querying Card Data

Use nushell for quick queries and analysis:

```sh
# List all legendary units
nu -c "open library/sets/core/units.csv | where rarity == 'legendary'"

# Count cards by rarity across all types
nu -c "glob library/sets/core/*.csv | each { open \$in } | flatten | group-by rarity | transpose key value | each { { rarity: \$in.key, count: (\$in.value | length) } }"
```

See `library/schema.md` for the full column definitions per card type.

## Project Structure

The project is organized into the following main directories:

- **rules/**: Contains the `Baseline` rules of the card game, detailing gameplay mechanics, objectives, and any special rules. Includes variants which can be loaded to override `Baseline` rules. Loaded by engine.
- **engine/**: Game engine. Processes game logic. Library used by clients and test runner. Loads rules.
- **test/**: Runs tests using the engine. Also handles running balance testing, collecting full game statistics for balancing and game design decisions.
- **library/**: Card definitions as CSV, built to JSON. See `library/schema.md` for column specs.
- **clients/**: Various game clients. For example: game web app, card design tool.
