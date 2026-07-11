#!/usr/bin/env nu
use std assert
use ../rarity-distribution.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  let r = (rarity-distribution run --set mini --build-dir $FIX)
  assert equal $r.check "rarity-distribution"
  assert equal $r.pass false                   # twin shrines are a dup pair
  assert equal $r.gaps 1
  # distribution: 5 common units, 3 common locations, etc.
  let dist = $r.detail.distribution
  assert equal ($dist | where type == "unit" and rarity == "common" | get 0.count) 4
  assert equal ($dist | where type == "location" and rarity == "common" | get 0.count) 2
  # dup group is the two identical spirituality_1 => 3vp shrines
  assert equal ($r.detail.duplicates | length) 1
  assert equal ($r.detail.duplicates | get 0.ids | sort) [twin-shrine-a twin-shrine-b]
  # the two identical reward-less outposts share a signature but are NOT flagged:
  # dup detection is mission-only (rewards != ""), so non-mission locations that
  # legitimately share (empty) requirements don't false-flag.
  let flagged = ($r.detail.duplicates | get ids | flatten)
  assert equal ($flagged | where { |id| $id in [outpost-a outpost-b] } | length) 0
  print "rarity-distribution.test.nu: OK"
}
