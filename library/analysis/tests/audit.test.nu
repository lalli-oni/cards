#!/usr/bin/env nu
use std assert
use ../audit.nu

const FIX = (path self | path dirname | path join fixtures)
const AUDIT_NU = (path self | path dirname | path join .. audit.nu | path expand)

export def main [] {
  let results = (audit run --set mini --build-dir $FIX)

  # one record per Layer 2 check, in a stable order
  assert equal ($results | length) 5
  assert equal ($results | get check) [
    dsl-verb-coverage negative-value rarity-distribution archetype-distribution mission-vp
  ]

  # summary classification: advisory vs PASS/FAIL
  let summ = ($results | audit summarize)
  assert equal ($summ | where check == "negative-value" | get 0.result) "advisory"
  assert equal ($summ | where check == "dsl-verb-coverage" | get 0.result) "FAIL"

  # hard failures drive the exit code — the 4 non-advisory failing checks on the
  # fixture, and negative-value is NOT among them
  let hard = (audit hard-failures $results)
  assert equal ($hard | get check | sort) [
    archetype-distribution dsl-verb-coverage mission-vp rarity-distribution
  ]

  # advisory exclusion is explicit: a "failing" negative-value never counts,
  # and passing hard checks never count
  let synth = [
    { check: dsl-verb-coverage, pass: true }
    { check: negative-value, pass: false }
    { check: mission-vp, pass: true }
  ]
  assert equal (audit hard-failures $synth | length) 0

  # --- PASS branch: a clean fixture where every hard check passes ---
  let clean = (audit run --set mini-clean --build-dir $FIX)
  let hard_clean = (audit hard-failures $clean)
  assert equal ($hard_clean | length) 0
  for c in ($clean | where check != "negative-value") {
    assert $c.pass $"expected ($c.check) to PASS on mini-clean"
  }

  # --- main's exit code: non-zero on hard failures, zero when all green ---
  let fail_run = (do { ^nu $AUDIT_NU --set mini --build-dir $FIX } | complete)
  assert equal $fail_run.exit_code 1
  let pass_run = (do { ^nu $AUDIT_NU --set mini-clean --build-dir $FIX } | complete)
  assert equal $pass_run.exit_code 0

  print "audit.test.nu: OK"
}
