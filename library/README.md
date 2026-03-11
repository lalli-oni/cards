# Card Library

Card definitions stored as CSV, built to JSON for the engine.

## Structure

```
library/
  sets/
    core/           # Core set
      units.csv
      locations.csv
      items.csv
      events.csv
      policies.csv
    expansion-1/    # Future sets follow same structure
      ...
  build/            # Generated JSON (gitignored)
  schema.md         # Column definitions per card type
  build.ts          # CSV → JSON build script
```

## Building

```sh
bun library/build.ts          # all sets
bun library/build.ts core     # specific set
```

Output goes to `library/build/`. The build validates required fields
and enums, exiting with errors if anything is invalid.

## Editing Cards

Edit the CSV files directly. Recommended workflows:

- **Nushell** — query, filter, and aggregate card data from the terminal.
  Your shell already handles CSVs natively:
  ```nu
  open library/sets/core/units.csv | where rarity == "legendary"
  open library/sets/core/units.csv | sort-by strength | reverse
  open library/sets/core/*.csv | group-by rarity | transpose key value | each { {rarity: $in.key, count: ($in.value | length)} }
  ```

- **Spreadsheet app** — open CSVs in Numbers, Excel, or Google Sheets
  for bulk editing. Re-export as CSV when done.

## Adding a New Set

1. Create a directory under `sets/` (e.g. `sets/expansion-1/`)
2. Add CSV files following the same column schema
3. Run `bun library/build.ts` to build

## Schema

See [schema.md](schema.md) for full column definitions per card type.
