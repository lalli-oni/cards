---
name: card-query
description: Query and aggregate card library data using nushell. Use for finding cards, counting by rarity/type/set, comparing stats, checking balance, and any card data questions.
---

# Card Query

Query the card library using the **analysis selectors** (`library/analysis/selectors.nu`)
over the built JSON. The selectors give composable, chainable building blocks so
queries stay consistent with the balance/coverage toolkit instead of hand-rolling
`open build/*.json | where ...`.

## Arguments
- Free-form natural language query about the card library (e.g. "how many legendaries in alpha-1", "show all units sorted by strength", "average cost by rarity")

## Setup

The selectors read the built JSON (`library/build/<set>.json`), which is gitignored.
Build it first if it's missing or stale:

```nu
bun library/build.ts alpha-1
```

Then run queries with the Bash tool via `nu -c '...'`, importing the selectors:

```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | ..."
```

`load-set` resolves the build dir relative to the toolkit, so it works from any cwd;
only the `use library/analysis/selectors.nu` path is relative to where you run `nu`
(run from the repo root).

## Selector building blocks

- `load-set <set>` — table of all cards in the set (adds numeric `gold-cost`)
- `of-type unit|location|item|event|policy` — filter by card type
- `of-rarity common|uncommon|rare|epic|legendary` — filter by rarity
- `has-attribute <Attr>` — cards with an attribute (the archetype axis)
- `has-verb <verb>` — cards whose effects use a DSL verb (`gold`, `contest`, `buff`, …)
- `with-verbs` — add `verbs` (DSL verbs used)
- `with-stat-total` — add `stat-total` (units)
- `with-ap-cost` — add `ap-cost` (activation AP)
- `with-payout` — add `gold-out` + `vp-out` (direct emissions, kept separate)

All are chainable and compose with native nushell (`select`, `where`, `sort-by`,
`group-by`, `to json`, …).

## Common patterns

**Filter and select:**
```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | of-type unit | of-rarity legendary | select name cost"
```

**Sort by a derived column:**
```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | of-type unit | with-stat-total | sort-by stat-total | reverse | select name stat-total"
```

**Filter by archetype (attribute):**
```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | has-attribute Military | select name type rarity"
```

**Filter by mechanic (DSL verb):**
```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | has-verb contest | select name"
```

**Count by group:**
```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | group-by rarity | transpose rarity cards | each { { rarity: $in.rarity, count: ($in.cards | length) } }"
```

**Average cost by rarity:**
```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | group-by rarity | transpose rarity cards | each { { rarity: $in.rarity, avg_cost: ($in.cards | get gold-cost | math avg) } }"
```

**Economy vs. objective payout:**
```nu
nu -c "use library/analysis/selectors.nu *; load-set alpha-1 | with-payout | where gold-out > 0 | select name gold-cost gold-out"
```

## Balance / coverage questions

For coverage and balance checks (keyword gaps, under-served archetypes, VP-path
gaps, rarity spread, payout screen), don't hand-roll — use the Layer 2 scripts or
the full audit:

```nu
nu library/analysis/audit.nu --set alpha-1                  # all checks, pass/fail table
nu library/analysis/archetype-distribution.nu --set alpha-1 # one check standalone
```

See `library/analysis/README.md` for the full toolkit.

## Rules
- Always use `nu -c '...'` via the Bash tool (single quotes outside, double inside)
- Import selectors with `use library/analysis/selectors.nu *` (run `nu` from the repo root)
- If the build JSON is missing/stale, run `bun library/build.ts <set>` first
- Present results as tables or summaries, not raw output
- For complex queries, chain selectors + native nushell pipes in one command
- If the user asks to modify data, suggest editing the CSV directly, then rebuilding
- After presenting results, offer follow-up queries if relevant
