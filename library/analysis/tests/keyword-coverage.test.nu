#!/usr/bin/env nu
use std assert
use ../keyword-coverage.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  # Fixture: Leader on 2 units (unit tier=2 → ok), Flying on 1 item (item tier=1
  # → ok), Aura on 1 location (location tier=2 → GAP).
  let r = (keyword-coverage run --set kwcov --build-dir ($FIX | path join kwcov))
  assert equal $r.check "keyword-coverage"
  assert equal $r.pass false
  assert equal $r.gaps 1
  let d = $r.detail
  assert equal ($d | where keyword == "Leader" | get 0.count) 2
  assert equal ($d | where keyword == "Leader" | get 0.status) "ok"
  assert equal ($d | where keyword == "Flying" | get 0.count) 1   # item tier = 1
  assert equal ($d | where keyword == "Flying" | get 0.status) "ok"
  assert equal ($d | where keyword == "Aura" | get 0.count) 1     # location tier = 2
  assert equal ($d | where keyword == "Aura" | get 0.status) "GAP"
  print "keyword-coverage.test.nu: OK"
}
