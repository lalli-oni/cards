#!/usr/bin/env nu
# Test harness: runs every *.test.nu in this directory and reports pass/fail.
# Exits non-zero if any test file fails, so it works in CI / pre-commit.

const HERE = (path self | path dirname)

export def main [] {
  let tests = (glob ($HERE | path join "*.test.nu") | sort)
  if ($tests | is-empty) {
    print "no *.test.nu files found"
    return
  }

  mut failed = []
  for t in $tests {
    let name = ($t | path basename)
    let res = (do { ^nu $t } | complete)
    # A test file must both exit 0 AND print its ": OK" sentinel — guards against
    # a file whose `main` is missing/unwired (exits 0 with no assertions run),
    # which would otherwise be a silent green.
    if $res.exit_code == 0 and ($res.stdout | str contains ": OK") {
      print $"  PASS  ($name)"
    } else {
      print $"  FAIL  ($name)"
      print ($res.stdout | str trim)
      print ($res.stderr | str trim)
      $failed = ($failed | append $name)
    }
  }

  print ""
  if ($failed | is-empty) {
    print $"All ($tests | length) test file\(s) passed."
  } else {
    error make { msg: $"($failed | length) of ($tests | length) test file\(s) failed: ($failed | str join ', ')" }
  }
}
