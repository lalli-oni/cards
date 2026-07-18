#!/usr/bin/env nu
use std assert
use ../dsl-verb-coverage.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  let r = (dsl-verb-coverage run --set mini --build-dir $FIX)
  assert equal $r.check "dsl-verb-coverage"
  assert equal $r.pass false
  assert equal $r.gaps 9                       # buy peek pick injure kill control raze to remove
  let counts = $r.detail
  assert equal ($counts | where verb == "gold" | get 0.count) 2
  assert equal ($counts | where verb == "contest" | get 0.count) 1
  assert equal ($counts | where verb == "raze" | get 0.count) 0
  assert equal ($counts | where verb == "raze" | get 0.status) "GAP"
  # pin the full gap SET, not just its size — a swap of one uncovered verb for
  # another (same count) would otherwise slip through
  assert equal ($counts | where count == 0 | get verb | sort) (
    [buy peek pick injure kill control raze to remove] | sort
  )
  print "dsl-verb-coverage.test.nu: OK"
}
