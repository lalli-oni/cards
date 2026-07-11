# Card-set analysis toolkit

Composable, rerunnable balance/coverage checks over the built card JSON
(`library/build/<set>.json`). Distinct from the rules-consistency tooling
(`card-rule-review`, `rule-consistency-checker`): this checks **balance and
coverage**, not rule correctness. Parameterised by set name — reusable for any
set, not just alpha-1.

Build first (output is gitignored):

```sh
bun library/build.ts <set>      # e.g. alpha-1
```

## Layers

**Layer 1 — `selectors.nu`** — composable building blocks. Every command is
`export def`; `load-set` sources a table of card records, and every other
command takes a table in and returns one out, so they chain and compose with
native nushell:

```nu
use library/analysis/selectors.nu *
load-set alpha-1 | of-type unit | has-attribute Military | with-stat-total | sort-by stat-total
```

Derived-column commands emit `null` on rows lacking their inputs (safe-null), so
mixed-type tables flow through.

| Command | Returns |
|---|---|
| `load-set <set> [--build-dir]` | table of card records + numeric `gold-cost` |
| `of-type` / `of-rarity` | filtered table |
| `has-attribute <attr>` | filtered table (attribute = archetype axis) |
| `has-keyword <verb>` | filtered table (DSL verb present in effects) |
| `with-keywords` | + `keywords` (DSL verbs used) |
| `with-stat-total` | + `stat-total` (units only) |
| `with-ap-cost` | + `ap-cost` (activation AP) |
| `with-payout` | + `gold-out`, `vp-out` (separate, never summed) |

**Layer 2 — insight scripts** — each encodes one #45 acceptance criterion and
reports gaps/violations with a `pass` flag:

| Script | Checks |
|---|---|
| `keyword-coverage.nu` | ≥1 card per DSL verb |
| `negative-value.nu` | payout screen (advisory review list) |
| `rarity-distribution.nu` | rarity spread + dup-prone locations |
| `archetype-distribution.nu` | under-served attributes |
| `mission-vp.nu` | each populated archetype has a mission VP path |

**Layer 3 — `audit.nu`** — runs all Layer 2 checks into one pass/fail table.

## Heuristics & caveats

- **Keyword coverage is measured against DSL verbs**, not the `abilities` column
  (which is empty across alpha-1). The verb list (`DSL_VERBS`) mirrors the engine.
- **No blended value number.** `gold-out`/`vp-out`/`ap-cost`/`gold-cost` are kept
  separate — gold ≠ vp, AP ≠ gold. A real value/EV rating model is deferred
  (see the value-rating follow-up).
- **`gold-out`/`vp-out` are partial** — only literal `gold[N]`/`vp[N]` emissions,
  not the indirect value of contests/buffs/control/tempo. The `negative-value`
  screen is a *review list*, not a balance verdict.
- **Archetype ≡ attribute.** A mechanics-derived gameplay/strategy archetype
  taxonomy is deferred post-v0.1 (#192).
- **`ATTRIBUTES` mirrors `engine/src/attributes.ts`** — keep in sync; a test pins it.

## Tests

```sh
nu library/analysis/tests/run.nu
```

Assertions are pinned against a synthetic fixture (`tests/fixtures/mini.json`),
not live set data, so they stay deterministic as real cards change.
