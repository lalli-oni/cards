#!/usr/bin/env nu
# dsl-verb-coverage.nu — assert ≥1 card per engine DSL verb; list unused verbs
# as gaps. Coverage is measured against DSL_VERBS (the engine's verb vocabulary,
# the authoritative source of card *mechanics* expressed in action effects) —
# distinct from mechanical-keyword coverage (see keyword-coverage.nu).

use selectors.nu *

export def run [--set: string = "alpha-1", --build-dir: string = ""] {
  let used = (load-set $set --build-dir $build_dir | with-verbs | get verbs | flatten)
  let counts = ($DSL_VERBS | each { |v|
    let n = ($used | where { |x| $x == $v } | length)
    { verb: $v, count: $n, status: (if $n > 0 { "ok" } else { "GAP" }) }
  })
  let gaps = ($counts | where count == 0 | get verb)
  {
    check: "dsl-verb-coverage",
    pass: ($gaps | is-empty),
    gaps: ($gaps | length),
    note: (if ($gaps | is-empty) { "all verbs covered" } else { $"unused verbs: ($gaps | str join ', ')" }),
    detail: $counts,
  }
}

export def main [--set: string = "alpha-1", --build-dir: string = ""] {
  let r = (run --set $set --build-dir $build_dir)
  print $"($r.check): (if $r.pass { 'PASS' } else { 'FAIL' }) — ($r.note)"
  $r.detail
}
