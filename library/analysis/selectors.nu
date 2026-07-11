#!/usr/bin/env nu
# library/analysis/selectors.nu
#
# Layer 1 — composable building blocks over library/build/<set>.json.
#
# Every command is `export def`. `load-set` is the source (nothing -> table);
# every other command takes a table of card records in and returns a table out,
# so they chain freely in a pipeline and compose with native nushell commands:
#
#   use selectors.nu *
#   load-set alpha-1 | of-type unit | has-attribute Military | with-stat-total | sort-by stat-total
#
# Derived-column commands emit `null` on rows that lack their inputs (safe-null)
# rather than erroring, so a mixed-type table still flows through.

# Canonical DSL verb vocabulary — the verbs the engine implements (see
# library/schema.md "Effect DSL"). Keyword coverage is measured against the
# effect DSL — the authoritative source of card mechanics — rather than the
# `abilities` column.
export const DSL_VERBS = [
  gold vp draw buy move peek pick buff contest injure kill control raze to remove
]

# Cross-type attribute vocabulary — MUST mirror engine/src/attributes.ts.
# Treated as the archetype axis by this toolkit (no separate mapping). A test
# pins this against the built cards to catch drift.
export const ATTRIBUTES = [
  Knowledge Military Diplomacy Commerce Politics
  Spirituality Engineering Exploration Espionage Culture
]

# Directory of THIS module file, resolved at parse-time. Lets scripts find the
# build dir relative to the toolkit regardless of the caller's cwd.
const ANALYSIS_DIR = (path self | path dirname)

# --- loading ---

# Load a built set as a table of card records, adding a numeric `gold-cost`.
# `--build-dir` overrides the default (`../build`) — used by tests on fixtures.
export def load-set [
  set: string
  --build-dir: string = ""
] {
  let dir = if ($build_dir | is-empty) {
    $ANALYSIS_DIR | path join .. build | path expand
  } else {
    $build_dir | path expand
  }
  let file = ($dir | path join $"($set).json")
  if not ($file | path exists) {
    error make { msg: $"build file not found: ($file) — run: bun library/build.ts ($set)" }
  }
  open $file | each { |card| $card | insert gold-cost (gold-cost-of $card) }
}

# --- filters (table -> table) ---

export def of-type [t: string] { where type == $t }

export def of-rarity [r: string] { where rarity == $r }

# The archetype filter (archetype ≡ attribute; no separate `in-archetype`).
export def has-attribute [attr: string] {
  where { |c| ($c.attributes? | default []) | any { |x| $x == $attr } }
}

export def has-keyword [verb: string] {
  where { |c| (card-verbs $c) | any { |v| $v == $verb } }
}

# --- derived columns (table -> table, additive, safe-null) ---

# `keywords`: DSL verbs used anywhere in a card's effect strings.
export def with-keywords [] {
  insert keywords { |c| card-verbs $c }
}

# `stat-total`: strength+cunning+charisma for units, else null.
export def with-stat-total [] {
  insert stat-total { |c| stat-total-of $c }
}

# `ap-cost`: the activation AP from actions[].apCost — a scalar for the common
# single-action card, a list for multi-action cards, null when there are none.
export def with-ap-cost [] {
  insert ap-cost { |c| ap-cost-of $c }
}

# `gold-out` and `vp-out`: net direct emission of each resource, kept SEPARATE
# (gold ≠ vp). Partial by design — captures only literal gold[N]/vp[N], not the
# indirect value of contests/buffs/control/tempo.
export def with-payout [] {
  insert gold-out { |c| emit-sum $c '\bgold\[(?<n>-?\d+)\]' }
  | insert vp-out { |c| emit-sum $c '\bvp\[(?<n>-?\d+)\]' }
}

# --- internal helpers ---

# Numeric gold cost: the scalar cost, or the MIN of an alternative-cost list
# (`a|b`, stored as a list post-build). Assumes gold currency — revisit if
# non-gold costs are introduced. A non-numeric cost (either the scalar or any
# alternative-cost element) coerces to null rather than crashing load-set, so a
# malformed cost degrades one card's `gold-cost` instead of aborting the set.
def gold-cost-of [card: record] {
  let c = ($card.cost? | default null)
  let t = ($c | describe)
  if ($t | str starts-with "list") {
    let ints = ($c | each { |v| try { $v | into int } catch { null } })
    # any unparseable element ⇒ the whole cost is untrustworthy ⇒ null
    if (($ints | is-empty) or ($ints | any { |x| $x == null })) {
      null
    } else {
      $ints | math min
    }
  } else if $t == "string" {
    try { $c | into int } catch { null }
  } else if $t == "int" {
    $c
  } else {
    null
  }
}

def stat-total-of [c: record] {
  if ($c.type? == "unit") {
    let stats = [$c.strength? $c.cunning? $c.charisma?]
    # A unit with no stats at all stays null (not a spurious 0); a unit with
    # some stats sums the present ones, treating absent as 0.
    if ($stats | all { |x| $x == null }) {
      null
    } else {
      $stats | each { |x| $x | default 0 } | math sum
    }
  } else {
    null
  }
}

def ap-cost-of [c: record] {
  let costs = ($c.actions? | default [] | get apCost? | compact)
  if ($costs | is-empty) {
    null
  } else if (($costs | length) == 1) {
    $costs | first
  } else {
    $costs
  }
}

# All DSL effect strings a card carries. Policy action effects are prose (not
# DSL) per build.ts, so policies are excluded.
def card-effects [c: record] {
  let type = ($c.type? | default "")
  mut effs = []
  if ($type in [unit item location]) {
    $effs = ($c.actions? | default [] | get effect? | compact)
  }
  if ($type == "event") and (($c.effect? | default null) != null) {
    $effs = ($effs | append $c.effect)
  }
  $effs
}

# Verbs from DSL_VERBS present as whole tokens in a card's effects.
def card-verbs [c: record] {
  let blob = (card-effects $c | str join " ")
  $DSL_VERBS | where { |v| $blob =~ ('\b' + $v + '\b') }
}

# Sum of the numeric capture `n` matched by `pattern` across a card's effects.
# Returns 0 (not error) when there are no matches.
def emit-sum [c: record, pattern: string] {
  card-effects $c
  | each { |e| $e | parse -r $pattern | get n }
  | flatten
  | each { |x| $x | into int }
  | reduce -f 0 { |it, acc| $acc + $it }
}
