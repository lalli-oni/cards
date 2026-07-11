#!/usr/bin/env nu
use std assert
use ../negative-value.nu

const FIX = (path self | path dirname | path join fixtures)

export def main [] {
  let r = (negative-value run --set mini --build-dir $FIX)
  assert equal $r.check "negative-value"
  assert equal $r.pass true                    # advisory — never fails
  # economy lens: emits gold but costs more than it returns → gold-sink (5 > 2),
  # NOT gold-engine (1 < 5)
  assert equal ($r.detail.economy | get id) [gold-sink]
  # objective lens: vp emitters → monument-builder
  assert equal ($r.detail.objective | get id) [monument-builder]
  print "negative-value.test.nu: OK"
}
