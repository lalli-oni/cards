#!/usr/bin/env nu
# archetype-distribution.nu — card count per archetype (= attribute); flags
# under-served archetypes below `--min` (default 2). A card with multiple
# attributes counts toward each.

use selectors.nu *

export def run [--set: string = "alpha-1", --build-dir: string = "", --min: int = 2] {
  let cards = (load-set $set --build-dir $build_dir)
  let counts = ($ATTRIBUTES | each { |a|
    let n = ($cards | has-attribute $a | length)
    { archetype: $a, count: $n, status: (if $n >= $min { "ok" } else { "under" }) }
  })
  let under = ($counts | where count < $min | get archetype)
  {
    check: "archetype-distribution",
    pass: ($under | is-empty),
    gaps: ($under | length),
    note: (if ($under | is-empty) { $"all archetypes >= ($min)" } else { $"under-served \(< ($min)): ($under | str join ', ')" }),
    detail: $counts,
  }
}

export def main [--set: string = "alpha-1", --build-dir: string = "", --min: int = 2] {
  let r = (run --set $set --build-dir $build_dir --min $min)
  print $"($r.check): (if $r.pass { 'PASS' } else { 'FAIL' }) — ($r.note)"
  $r.detail
}
