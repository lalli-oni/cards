#!/usr/bin/env nu
# audit.nu — Layer 3. Runs every Layer 2 check and emits a single pass/fail
# table. Doubles as #45's rerunnable definition-of-done checklist.
#
#   nu library/analysis/audit.nu                 # audit alpha-1 (build must exist)
#   nu library/analysis/audit.nu --set alpha-1 --build   # rebuild first, then audit
#
# Exits non-zero if any HARD check fails. `negative-value` is advisory (a review
# list) and never fails the audit.

use dsl-verb-coverage.nu
use keyword-coverage.nu
use negative-value.nu
use rarity-distribution.nu
use archetype-distribution.nu
use mission-vp.nu

const ANALYSIS_DIR = (path self | path dirname)

# Advisory checks never fail the audit — they surface review lists only.
const ADVISORY = [negative-value]

# Run every check, returning the list of structured result records.
export def run [--set: string = "alpha-1", --build-dir: string = ""] {
  [
    (dsl-verb-coverage run --set $set --build-dir $build_dir)
    (keyword-coverage run --set $set --build-dir $build_dir)
    (negative-value run --set $set --build-dir $build_dir)
    (rarity-distribution run --set $set --build-dir $build_dir)
    (archetype-distribution run --set $set --build-dir $build_dir)
    (mission-vp run --set $set --build-dir $build_dir)
  ]
}

# Collapse results to the summary table shown to the user.
export def summarize [] {
  each { |r|
    {
      check: $r.check,
      result: (if ($r.check in $ADVISORY) { "advisory" } else if $r.pass { "PASS" } else { "FAIL" }),
      gaps: $r.gaps,
      note: $r.note,
    }
  }
}

# Hard failures = non-advisory checks that did not pass. These drive the exit
# code; advisory checks (negative-value) are excluded even if not "passing".
export def hard-failures [results: list] {
  $results | where { |r| (not ($r.check in $ADVISORY)) and (not $r.pass) }
}

export def main [--set: string = "alpha-1", --build-dir: string = "", --build] {
  if $build {
    let build_ts = ($ANALYSIS_DIR | path join .. build.ts | path expand)
    print $"building set ($set)..."
    ^bun $build_ts $set
  }

  let results = (run --set $set --build-dir $build_dir)
  print ($results | summarize)

  let failed = (hard-failures $results)
  if ($failed | is-not-empty) {
    print $"AUDIT FAILED — ($failed | length) hard check\(s): ($failed | get check | str join ', ')"
    exit 1
  }
  print "AUDIT PASSED — all hard checks green"
}
