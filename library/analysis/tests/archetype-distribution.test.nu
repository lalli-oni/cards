#!/usr/bin/env nu
use std assert
use ../archetype-distribution.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  let r = (archetype-distribution run --set mini --build-dir $FIX --min 2)
  assert equal $r.check "archetype-distribution"
  assert equal $r.pass false
  let counts = $r.detail
  assert equal ($counts | where archetype == "Military" | get 0.count) 3
  assert equal ($counts | where archetype == "Commerce" | get 0.count) 1
  assert equal ($counts | where archetype == "Culture" | get 0.count) 0
  # Military (3) is not under-served at min 2; Culture (0) is
  assert equal ($counts | where archetype == "Military" | get 0.status) "ok"
  assert equal ($counts | where archetype == "Culture" | get 0.status) "under"
  print "archetype-distribution.test.nu: OK"
}
