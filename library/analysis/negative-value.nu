#!/usr/bin/env nu
# negative-value.nu — the "Golden Age" payout screen. ADVISORY: surfaces review
# candidates, not balance violations (most cards intentionally have indirect
# value that this cannot measure). Two honest lenses, kept separate:
#   economy — cards that emit gold but cost more gold than they return
#   objective — cards that emit vp (cost per vp), listed for review
# Never fails the audit. A real value/EV rating model is intentionally out of
# scope for this toolkit (no blended value number is emitted) — deferred to #193.

use selectors.nu *

export def run [--set: string = "alpha-1", --build-dir: string = ""] {
  let cards = (load-set $set --build-dir $build_dir | with-payout)
  let economy = ($cards
    | where { |c| ($c.gold-out > 0) and ($c.gold-cost != null) and ($c.gold-cost > $c.gold-out) }
    | select id type gold-cost gold-out)
  let objective = ($cards
    | where vp-out > 0
    | select id type gold-cost vp-out)
  {
    check: "negative-value",
    pass: true,   # advisory — a review list, never an audit failure
    gaps: ($economy | length),
    note: $"($economy | length) economy review candidate\(s), ($objective | length) vp emitter\(s) [advisory]",
    detail: { economy: $economy, objective: $objective },
  }
}

export def main [--set: string = "alpha-1", --build-dir: string = ""] {
  let r = (run --set $set --build-dir $build_dir)
  print $"($r.check): ($r.note)"
  print "economy (gold-cost > gold-out):"
  print $r.detail.economy
  print "objective (vp emitters):"
  $r.detail.objective
}
