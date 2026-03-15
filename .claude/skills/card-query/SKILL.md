---
name: card-query
description: Query and aggregate card library data using nushell. Use for finding cards, counting by rarity/type/set, comparing stats, checking balance, and any card data questions.
---

# Card Query

Query the card library CSV files using nushell for filtering, aggregation, and analysis.

## Arguments
- Free-form natural language query about the card library (e.g. "how many legendaries in baseline", "show all units sorted by strength", "average cost by rarity")

## Instructions

Use the Bash tool to run `nu -c '<command>'` for all queries. The card CSVs are at `library/sets/{set}/` with files: `units.csv`, `locations.csv`, `items.csv`, `events.csv`, `policies.csv`.

### Common patterns

**Open a single file:**
```nu
nu -c "open library/sets/baseline/units.csv"
```

**Filter rows:**
```nu
nu -c "open library/sets/baseline/units.csv | where rarity == 'legendary'"
nu -c "open library/sets/baseline/units.csv | where strength > 5"
```

**Select columns:**
```nu
nu -c "open library/sets/baseline/units.csv | select name rarity cost strength"
```

**Sort:**
```nu
nu -c "open library/sets/baseline/units.csv | sort-by strength | reverse"
```

**Load all cards from a set:**
```nu
nu -c "glob library/sets/baseline/*.csv | each { open $in } | flatten"
```

**Load all cards across all sets:**
```nu
nu -c "glob library/sets/**/*.csv | each { open $in } | flatten"
```

**Count by group:**
```nu
nu -c "glob library/sets/baseline/*.csv | each { open $in } | flatten | group-by rarity | transpose key value | each { { rarity: $in.key, count: ($in.value | length) } }"
```

**Cross-type stats:**
```nu
nu -c "glob library/sets/baseline/*.csv | each { |f| open $f | insert type ($f | path parse | get stem) } | flatten | group-by type | transpose key value | each { { type: $in.key, count: ($in.value | length) } }"
```

## Rules
- Always use `nu -c '...'` via the Bash tool (use single quotes for the nu command, double quotes inside)
- Present results as tables or summaries, not raw output
- For complex queries, chain nushell pipes — avoid multiple separate commands
- If the user asks to modify data, suggest editing the CSV directly instead
- After presenting results, offer follow-up queries if relevant
