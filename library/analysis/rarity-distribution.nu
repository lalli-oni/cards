#!/usr/bin/env nu
# rarity-distribution.nu — counts per type × rarity, and flags dup-prone mission
# locations (missions sharing identical requirements+rewards, which would stack
# indistinguishably in a market).

use selectors.nu *

export def run [--set: string = "alpha-1", --build-dir: string = ""] {
  let cards = (load-set $set --build-dir $build_dir)
  if ($cards | is-empty) {
    error make { msg: $"($set): empty card set — nothing to analyze (rarity-distribution)" }
  }

  let dist = ($cards | group-by type | transpose type rows | each { |g|
    $g.rows | group-by { |c| $c.rarity? | default "unknown" } | transpose rarity rs | each { |r|
      { type: $g.type, rarity: $r.rarity, count: ($r.rs | length) }
    }
  } | flatten)

  # Dup-prone: mission locations (those with rewards) that share the same
  # requirements + rewards.
  let missions = ($cards | where type == "location" | where { |l| ($l.rewards? | default "") != "" })
  let dups = ($missions
    | group-by { |m| $"($m.requirements? | default '')=>($m.rewards? | default '')" }
    | transpose signature group
    | where { |g| ($g.group | length) > 1 }
    | each { |g| { signature: $g.signature, ids: ($g.group | get id) } })

  {
    check: "rarity-distribution",
    pass: ($dups | is-empty),
    gaps: ($dups | length),
    note: (if ($dups | is-empty) { "no duplicate mission locations" } else { $"($dups | length) dup-prone location group\(s)" }),
    detail: { distribution: $dist, duplicates: $dups },
  }
}

export def main [--set: string = "alpha-1", --build-dir: string = ""] {
  let r = (run --set $set --build-dir $build_dir)
  print $"($r.check): (if $r.pass { 'PASS' } else { 'FAIL' }) — ($r.note)"
  print $r.detail.distribution
  print "dup-prone locations:"
  $r.detail.duplicates
}
