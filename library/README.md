# Card Library

Card definitions stored as CSV, built to JSON for the engine.

## Structure

```
library/
  sets/
    alpha-1/        # The first playable set
      set.toml      # Set-level metadata: description, target counts, design notes
      units.csv
      locations.csv
      items.csv
      events.csv
      policies.csv
  analysis/         # Balance/coverage checks over the built JSON (see analysis/README.md)
  build/            # Generated JSON (gitignored)
  schema.md         # Column definitions per card type
  build.ts          # CSV → JSON build script
```

`alpha-1` is currently the only set. `set.toml` describes the set as a whole —
what it is for, its target counts per type × tier, and the design decisions
behind them — where `schema.md` describes the shape of a single card row.

## Building

```sh
bun library/build.ts          # all sets
bun library/build.ts alpha-1  # specific set
```

Output goes to `library/build/`. The build validates required fields
and enums, exiting with errors if anything is invalid.

## Editing Cards

Edit the CSV files directly. Recommended workflows:

- **Nushell** — query, filter, and aggregate card data from the terminal.
  Your shell already handles CSVs natively:
  ```nu
  open library/sets/alpha-1/units.csv | where rarity == "legendary"
  open library/sets/alpha-1/units.csv | sort-by strength | reverse
  open library/sets/alpha-1/*.csv | group-by rarity | transpose key value | each { {rarity: $in.key, count: ($in.value | length)} }
  ```

- **Spreadsheet app** — open CSVs in Numbers, Excel, or Google Sheets
  for bulk editing. Re-export as CSV when done.

## Adding a New Set

1. Create a directory under `sets/` (e.g. `sets/alpha-2/`)
2. Add CSV files following the same column schema
3. Add a `set.toml` describing the set — see `sets/alpha-1/set.toml`. The format
   is provisional: no key spec exists yet and the build does not validate it,
   so copy the example rather than inventing keys. The spec lands with #276.
4. Run `bun library/build.ts` to build

## Schema

See [schema.md](schema.md) for full column definitions per card type.
