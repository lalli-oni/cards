#!/usr/bin/env nu
# keyword-coverage.nu — assert governed mechanical-keyword coverage against the
# `keywords` column, with a tiered threshold: unit/location keywords need ≥2
# cards, equipment (item) keywords need ≥1. The governed vocabulary is read from
# the build's `keywords.json` (emitted by library/build.ts from
# engine/src/keywords.ts), so the check can't drift from the source of truth.
#
# DSL-verb coverage (≥1 card per engine DSL verb) is a separate check — see
# dsl-verb-coverage.nu.

use selectors.nu *

const ANALYSIS_DIR = (path self | path dirname)

# Coverage tier: equipment (item-scoped) keywords need 1 card, others need 2.
def threshold-of [types: list] {
  if ("item" in $types) { 1 } else { 2 }
}

# The keyword name of a token ("Leader:+1:all:combat" -> "Leader").
def token-name [tok: string] {
  $tok | split row ":" | first
}

export def run [--set: string = "alpha-1", --build-dir: string = ""] {
  let dir = if ($build_dir | is-empty) {
    $ANALYSIS_DIR | path join .. build | path expand
  } else {
    $build_dir | path expand
  }
  let vocab_file = ($dir | path join "keywords.json")
  if not ($vocab_file | path exists) {
    error make { msg: $"keyword vocabulary not found: ($vocab_file) — run: bun library/build.ts" }
  }
  let vocab = (open $vocab_file)
  let cards = (load-set $set --build-dir $dir)

  let counts = ($vocab | each { |k|
    let n = ($cards | where { |c|
      ($c.keywords? | default []) | any { |tok| (token-name $tok) == $k.name }
    } | length)
    let need = (threshold-of $k.cardTypes)
    { keyword: $k.name, count: $n, need: $need, status: (if $n >= $need { "ok" } else { "GAP" }) }
  })
  let gaps = ($counts | where status == "GAP" | get keyword)
  {
    check: "keyword-coverage",
    pass: ($gaps | is-empty),
    gaps: ($gaps | length),
    note: (if ($gaps | is-empty) { "all keywords meet their coverage tier" } else { $"under-covered: ($gaps | str join ', ')" }),
    detail: $counts,
  }
}

export def main [--set: string = "alpha-1", --build-dir: string = ""] {
  let r = (run --set $set --build-dir $build_dir)
  print $"($r.check): (if $r.pass { 'PASS' } else { 'FAIL' }) — ($r.note)"
  $r.detail
}
