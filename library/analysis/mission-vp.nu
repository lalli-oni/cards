#!/usr/bin/env nu
# mission-vp.nu — each populated archetype (attribute that appears on ≥1 card)
# should have a viable VP path: a mission location whose requirements reference
# that attribute. Flags archetypes with cards but no mission demand.
#
# Mission requirements use lowercase attribute tokens (`knowledge_2`,
# `military_1`); stat/unit checks (`strength_15`, `units_3`) don't name an
# attribute and are ignored here.

use selectors.nu *

export def run [--set: string = "alpha-1", --build-dir: string = ""] {
  let cards = (load-set $set --build-dir $build_dir)

  let missions = ($cards | where type == "location" | where { |l| ($l.rewards? | default "") != "" })
  let mission_attrs = ($missions | each { |m|
      $m.requirements? | default "" | split row ";"
      | each { |chk| $chk | parse -r '^(?<attr>[a-z]+)_\d+$' | get attr? }
      | flatten
    } | flatten | compact | uniq)

  let populated = ($ATTRIBUTES | where { |a| ($cards | has-attribute $a | length) > 0 })
  let rows = ($populated | each { |a|
    let has = ($mission_attrs | any { |m| $m == ($a | str downcase) })
    { archetype: $a, "has-path": $has }
  })
  let gaps = ($rows | where "has-path" == false | get archetype)
  {
    check: "mission-vp",
    pass: ($gaps | is-empty),
    gaps: ($gaps | length),
    note: (if ($gaps | is-empty) { "every populated archetype has a mission path" } else { $"no VP path: ($gaps | str join ', ')" }),
    detail: $rows,
  }
}

export def main [--set: string = "alpha-1", --build-dir: string = ""] {
  let r = (run --set $set --build-dir $build_dir)
  print $"($r.check): (if $r.pass { 'PASS' } else { 'FAIL' }) — ($r.note)"
  $r.detail
}
