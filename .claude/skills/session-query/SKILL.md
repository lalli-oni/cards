---
name: session-query
description: Query and analyze game session data using nushell. Use for balance testing insights, win rates, game length stats, card usage patterns, and any session data questions.
---

# Session Query

Query game session JSON files using nushell for balance analysis and game design insights.

## Arguments
- Free-form natural language query about session data (e.g. "win rate by first player", "average game length", "most deployed cards", "score distribution by variant")

## Instructions

Use the Bash tool to run `nu -c '<command>'` for all queries. Session files are JSON at `sessions/*.json`.

### Session file structure

Each session contains:
- `version` — engine version
- `config` — variant config used
- `players` — list of `{ id, name }`
- `seed` — game RNG seed
- `actions` — ordered list of `{ turn, player, type, ... }`
- `result` — `{ winner, scores, turns }`

### Common patterns

**Load all sessions:**
```nu
nu -c "glob sessions/*.json | each { open $in }"
```

**Win rate by player position:**
```nu
nu -c "glob sessions/*.json | each { open $in } | each { |s| { winner_index: ($s.players | enumerate | where { $in.item.id == $s.result.winner } | get 0.index) } } | group-by winner_index | transpose key value | each { { position: $in.key, wins: ($in.value | length) } }"
```

**Average game length:**
```nu
nu -c "glob sessions/*.json | each { open $in | get result.turns } | math avg"
```

**Score distribution:**
```nu
nu -c "glob sessions/*.json | each { open $in | get result.scores } | flatten | values | math avg"
```

**Most used cards (by deploy actions):**
```nu
nu -c "glob sessions/*.json | each { open $in | get actions } | flatten | where type == 'deploy' | group-by card | transpose key value | each { { card: $in.key, count: ($in.value | length) } } | sort-by count | reverse"
```

**Filter by variant:**
```nu
nu -c "glob sessions/*.json | each { open $in } | where config.variant == 'baseline'"
```

**Games where a specific card was deployed:**
```nu
nu -c "glob sessions/*.json | each { |s| if ($s | open | get actions | where type == 'deploy' and card == 'cleopatra' | length) > 0 { open $s } } | compact"
```

## Rules
- Always use `nu -c '...'` via the Bash tool
- Present results as tables or summaries with interpretation
- For balance concerns, highlight statistical outliers (e.g. win rates far from 50%, cards never or always played)
- Suggest follow-up queries when patterns are interesting
- If no session files exist yet, tell the user and suggest running the test runner to generate sessions
