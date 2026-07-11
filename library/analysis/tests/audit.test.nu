#!/usr/bin/env nu
use std assert
use ../audit.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  let results = (audit run --set mini --build-dir $FIX)

  # one record per Layer 2 check, in a stable order
  assert equal ($results | length) 5
  assert equal ($results | get check) [
    keyword-coverage negative-value rarity-distribution archetype-distribution mission-vp
  ]

  # summary classification: advisory vs PASS/FAIL
  let summ = ($results | audit summarize)
  assert equal ($summ | where check == "negative-value" | get 0.result) "advisory"
  assert equal ($summ | where check == "keyword-coverage" | get 0.result) "FAIL"

  # hard failures drive the exit code — the 4 non-advisory failing checks on the
  # fixture, and negative-value is NOT among them
  let hard = (audit hard-failures $results)
  assert equal ($hard | get check | sort) [
    archetype-distribution keyword-coverage mission-vp rarity-distribution
  ]

  # advisory exclusion is explicit: a "failing" negative-value never counts,
  # and passing hard checks never count
  let synth = [
    { check: keyword-coverage, pass: true }
    { check: negative-value, pass: false }
    { check: mission-vp, pass: true }
  ]
  assert equal (audit hard-failures $synth | length) 0

  print "audit.test.nu: OK"
}
