#!/usr/bin/env nu
# Tests for selectors.nu — pinned against the synthetic fixture (fixtures/mini.json),
# not live set data, so assertions stay deterministic as real cards churn.

use std assert
use ../selectors.nu *

const FIX = (path self | path dirname | path join fixtures)

def cards [] { load-set mini --build-dir $FIX }

def one [id: string] { cards | where id == $id | first }

export def main [] {
  # --- load-set: gold-cost coercion, incl. alternative-cost min ---
  assert equal (one gold-sink | get gold-cost) 5
  assert equal (one general | get gold-cost) 2      # min of ["4","2"]
  assert equal (one the-archive | get gold-cost) 0

  # --- with-stat-total: units sum, non-units null (safe-null) ---
  assert equal (one gold-sink | with-stat-total | get stat-total) 12
  assert equal (one general | with-stat-total | get stat-total) 15
  assert equal (one the-archive | with-stat-total | get stat-total) null

  # --- with-ap-cost: activation AP, null when no actions (safe-null) ---
  assert equal (one gold-sink | with-ap-cost | get ap-cost) 1
  assert equal (one gold-engine | with-ap-cost | get ap-cost) 2
  assert equal (one twin-shrine-a | with-ap-cost | get ap-cost) null

  # --- with-payout: gold-out and vp-out kept separate, never summed ---
  assert equal (one gold-sink | with-payout | get gold-out) 2
  assert equal (one gold-engine | with-payout | get gold-out) 5
  assert equal (one warrior | with-payout | get gold-out) 0
  assert equal (one monument-builder | with-payout | get vp-out) 1
  assert equal (one monument-builder | with-payout | get gold-out) 0

  # --- with-keywords: whole-token DSL verbs; empty on effect-less cards ---
  assert equal (one warrior | with-keywords | get keywords) [contest]
  assert equal (one monument-builder | with-keywords | get keywords) [vp]
  assert equal (one scholar | with-keywords | get keywords) [draw]
  assert equal (one pilgrim | with-keywords | get keywords) [move]
  assert equal (one the-archive | with-keywords | get keywords) []

  # --- filters compose and drop rows only ---
  assert equal (cards | of-type unit | length) 7
  assert equal (cards | of-type location | length) 3
  assert equal (cards | of-type unit | has-attribute Military | get id) [gold-sink warrior general]
  assert equal (cards | has-keyword contest | get id) [warrior]
  assert equal (cards | of-rarity common | length) 6

  # --- constants ---
  assert equal ($DSL_VERBS | length) 15
  assert ($DSL_VERBS | any { |v| $v == "raze" })
  assert equal ($ATTRIBUTES | length) 10
  assert equal $ATTRIBUTES [
    Knowledge Military Diplomacy Commerce Politics
    Spirituality Engineering Exploration Espionage Culture
  ]

  print "selectors.test.nu: OK"
}
