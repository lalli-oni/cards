#!/usr/bin/env nu
use std assert
use ../keyword-coverage.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  let r = (keyword-coverage run --set mini --build-dir $FIX)
  assert equal $r.check "keyword-coverage"
  assert equal $r.pass false
  assert equal $r.gaps 9                       # buy peek pick injure kill control raze to remove
  let counts = $r.detail
  assert equal ($counts | where verb == "gold" | get 0.count) 2
  assert equal ($counts | where verb == "contest" | get 0.count) 1
  assert equal ($counts | where verb == "raze" | get 0.count) 0
  assert equal ($counts | where verb == "raze" | get 0.status) "GAP"
  print "keyword-coverage.test.nu: OK"
}
