# Card Game Project

## Overview
A collectible card game with decoupled architecture: rules (markdown) -> engine -> clients/test/library.

See [README.md](README.md) for full project structure.

## Key Conventions
- `rules/` contains only markdown files defining game rules — no code
- Variant-dependent values use `[var:id:baseline_value]` format (e.g. `[var:starting_gold:10]` means the baseline value is 10, keyed by `starting_gold`)
- Design commentary uses `[design:...]` format
- Avoid duplication of rules across files; link instead
- When rule sections grow long, split into a dedicated file and link from the parent

## Architecture

Monorepo with bun workspaces. Single version (`package.json` root). Rules and library are data directories (no package.json); engine, clients, and test are workspaces.

- **rules/**: Baseline rules in markdown. Variants override baseline values. Loaded by engine.
- **engine/**: (`cards-engine`) Game engine. Processes logic, manages state. Workspace package imported by clients and test.
- **library/**: Card definitions as CSV, built to JSON. See `library/schema.md` for column specs.
- **clients/**: Game clients (web app, card design tool, etc.). Each client is a workspace.
- **test/**: (`cards-test`) Test runner and balance testing. Imports `cards-engine`.

## Card Library

- Cards are stored as **CSV files** in `library/sets/{set_name}/` — one file per card type
- Build to JSON with `bun library/build.ts` (output in `library/build/`, gitignored)
- Schema and column definitions are in `library/schema.md`
- ID format: kebab-case of card name (e.g. `cleopatra`, `investment-banking`). Globally unique.
- Card types: unit, location, item, event, policy
- Delimiters within fields: `;` for lists, `|` for alternative costs, `:` for action components
- When adding cards, always run the build script to validate
- New sets: create a new directory under `library/sets/` with the same CSV structure

### Workflows
- **Editing**: Use VisiData (`vd library/sets/baseline/units.csv`) for terminal spreadsheet editing, or Numbers/Excel for bulk sessions
- **Querying**: Use `/card-query` skill to query card data with nushell
- **Building**: Run `bun library/build.ts` after edits to validate and generate JSON
