---
name: card-rule-review
description: Check if cards in the library are consistent with the current rules. Flags mismatches between card definitions and game rules.
---

# Card Rule Review

Compare card definitions against the current rules and flag inconsistencies.

## Arguments
- Optional: card type to focus on (e.g. "units", "locations", "events")
- Optional: specific rule area to check against (e.g. "combat", "economy", "keywords")
- If no arguments: review all card types against all rules

## Steps

### 1. Read the rules

Read all rule files in `rules/`:
- `rules/README.md` (master design document)
- Any other `.md` files linked from it (e.g. `rules/market.md`)

Extract from the rules:
- Valid stats, attributes, keywords
- Card type definitions and subtypes
- Action mechanics, contest types, effects
- Economy rules (cost expectations, gold generation)
- Zone names, phase structure
- Rarity rules and limits

### 2. Load cards

Use nushell to load the relevant cards:

```sh
# all cards
nu -c "glob library/sets/**/*.csv | each { |f| open $f | insert _file ($f | path parse | get stem) } | flatten"

# or specific type
nu -c "glob library/sets/**/units.csv | each { open $in } | flatten"
```

### 3. Check for mismatches

For each card, check:
- **Stats**: does the card use stats that exist in the rules?
- **Attributes**: are all attributes valid per the rules?
- **Keywords**: are all keywords defined in the rules?
- **Actions**: do action mechanics match what the rules allow (contest types, effect types, AP cost ranges)?
- **Subtypes**: for events — is the subtype valid?
- **Card text**: does the text reference mechanics, zones, or concepts that exist in the rules?
- **Economy**: is the cost reasonable given the rules' economy structure?

### 4. Report

Present findings as a table:

| Card ID | Card Name | Issue | Details | Suggested Fix |
|---------|-----------|-------|---------|---------------|

Severity levels:
- **Breaking** — card references something that doesn't exist in the rules
- **Review** — possible inconsistency, needs human judgment

Only show cards with issues. Summarize the total checked vs flagged at the end.

## Rules
- Never modify card CSVs — only flag and suggest
- Be specific about which field on the card is affected
- When uncertain, flag as "Review" rather than skipping
- Read `library/schema.md` if needed to understand column structure
