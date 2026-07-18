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
| `has-verb <verb>` | filtered table (DSL verb present in effects) |
| `with-verbs` | + `verbs` (DSL verbs used) |
| `with-stat-total` | + `stat-total` (units only) |
| `with-ap-cost` | + `ap-cost` (activation AP) |
| `with-payout` | + `gold-out`, `vp-out` (separate, never summed) |

**Layer 2 — insight scripts** — each encodes one #45 acceptance criterion and
reports gaps/violations with a `pass` flag:

| Script | Checks |
|---|---|
| `keyword-coverage.nu` | governed keywords meet coverage tier (2 unit/location, 1 equipment) |
| `dsl-verb-coverage.nu` | ≥1 card per engine DSL verb |
| `negative-value.nu` | payout screen (advisory review list) |
| `rarity-distribution.nu` | rarity spread + dup-prone locations |
| `archetype-distribution.nu` | under-served attributes |
| `mission-vp.nu` | each populated archetype has a mission VP path |

**Layer 3 — `audit.nu`** — runs all Layer 2 checks into one pass/fail table.

## Heuristics & caveats

- **Two coverage checks, two axes.** `keyword-coverage.nu` checks the governed
  mechanical-keyword vocabulary (from `keywords.json`) against the `keywords`
  column, tiered (2 unit/location, 1 equipment). `dsl-verb-coverage.nu` checks
  effect-DSL verb coverage (the `DSL_VERBS` list, mirroring the engine) against
  action effects — a separate axis of "card mechanics".
- **No blended value number.** `gold-out`/`vp-out`/`ap-cost`/`gold-cost` are kept
  separate — gold ≠ vp, AP ≠ gold. This toolkit emits no single value verdict.
- **`gold-out`/`vp-out` are partial** — only literal `gold[N]`/`vp[N]` emissions,
  not the indirect value of contests/buffs/control/tempo. The `negative-value`
  screen is a *review list*, not a balance verdict.
- **Archetype ≡ attribute.** The toolkit uses a card's attribute as its archetype axis.
- **`ATTRIBUTES` mirrors `engine/src/attributes.ts`** — keep in sync; a test pins it.

## Roadmap (deferred post-v0.1)

- **Value/EV rating model** ([#193](https://github.com/lalli-oni/cards/issues/193)) —
  a real card power estimate accounting for indirect value (contests, buffs,
  control, tempo), not just literal `gold[N]`/`vp[N]` payout. Would upgrade
  `negative-value` from an advisory screen into a gating check.
- **Gameplay/strategy archetype taxonomy** ([#192](https://github.com/lalli-oni/cards/issues/192)) —
  a mechanics-derived archetype axis distinct from the attribute axis used today.

## Tests

```sh
nu library/analysis/tests/run.nu
```

Assertions are pinned against a synthetic fixture (`tests/fixtures/mini.json`),
not live set data, so they stay deterministic as real cards change.
