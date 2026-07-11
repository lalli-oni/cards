#!/usr/bin/env nu
use std assert
use ../mission-vp.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  let r = (mission-vp run --set mini --build-dir $FIX)
  assert equal $r.check "mission-vp"
  assert equal $r.pass false
  # Knowledge (archive) and Spirituality (shrines) have mission paths;
  # Military / Commerce / Politics have cards but no mission demand.
  let rows = $r.detail
  assert equal ($rows | where archetype == "Knowledge" | get 0.has-path) true
  assert equal ($rows | where archetype == "Spirituality" | get 0.has-path) true
  assert equal ($rows | where archetype == "Military" | get 0.has-path) false
  assert equal ($rows | where archetype == "Commerce" | get 0.has-path) false
  assert equal ($rows | where archetype == "Politics" | get 0.has-path) false
  print "mission-vp.test.nu: OK"
}
