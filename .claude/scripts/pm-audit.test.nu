# Tests for pm-audit.nu rules. Run: nu .claude/scripts/pm-audit.test.nu
#
# Every rule is fed hand-built fixtures shaped like the normalised gh output
# (see fetch-issues / fetch-prs in pm-audit.nu). Each case is modelled on a real
# state this repo has been in, so a rule that stops catching it is a regression
# against something that actually went wrong.

use std/assert
use pm-audit.nu *

const NOW = 2026-10-31T12:00:00Z

def issue [n: int, state: string, --labels: list<string> = [engine], --milestone: any = null, --reason: any = null, --closed: any = null, --body: string = "", --title: string = "t"]: nothing -> record {
  {number: $n, title: $title, state: $state, stateReason: $reason, labels: $labels, milestone: $milestone, body: $body, closedAt: $closed}
}

def pr [n: int, state: string, title: string, --refs: list<int> = [], --files: list<string> = [], --changed: int = 1, --updated: string = "2026-10-30T00:00:00Z", --head: string = "b", --oid: string = "x"]: nothing -> record {
  {
    number: $n, title: $title, state: $state, isDraft: false, headRefName: $head, headRefOid: $oid,
    updatedAt: $updated, changedFiles: $changed, files: $files,
    closingIssuesReferences: ($refs | each {|r| {number: $r} })
  }
}

def rules-of [findings: list<record>]: nothing -> list<string> { $findings | get -o rule | default [] }

# --- linking PRs to issues ------------------------------------------------------

# !288's title "284: …; 289: …" carried two issues; both must link even though
# its closingIssuesReferences only had one.
def "test pr-issue-numbers reads closing refs and multi-issue titles" [] {
  let p: record = (pr 288 MERGED "284: copies column; 289: stop dropping CSV data" --refs [284])
  assert equal (pr-issue-numbers $p | sort) [284 289]
}

# Titles without the "NNN:" prefix (e.g. !291 "Point the copies column at …")
# must not produce spurious links from digits elsewhere in the title.
def "test pr-issue-numbers ignores digits that are not a prefix" [] {
  let p: record = (pr 291 MERGED "Point at issue 290 now")
  assert equal (pr-issue-numbers $p) []
}

# --- open-issue-merged-pr -------------------------------------------------------

# #199 stayed open for months after its PR #200 merged, with its deferred list
# quietly resolved elsewhere. That is exactly what this rule surfaces.
def "test open issue with merged PR is flagged" [] {
  let found: list<record> = (rule-open-issue-merged-pr [(issue 199 OPEN)] [(pr 200 MERGED "199: renderer")])
  assert equal ($found | get ref) ["#199"]
}

# An issue mid-way through a multi-PR sequence (one merged, one still open) is
# work in progress, not drift.
def "test merged PR plus an open PR is not flagged" [] {
  let prs: list<record> = [(pr 1 MERGED "50: part one") (pr 2 OPEN "50: part two")]
  assert equal (rule-open-issue-merged-pr [(issue 50 OPEN)] $prs) []
}

# Epics (#45) collect many merged PRs by design and stay open.
def "test epics are exempt from merged-PR flag" [] {
  let found: list<record> = (rule-open-issue-merged-pr [(issue 45 OPEN --labels [epic cards])] [(pr 277 MERGED "45: lock counts")])
  assert equal $found []
}

# --- open-issue-abandoned-pr ----------------------------------------------------

# #194's PR !198 was closed unmerged; had #194 stayed open, the next attempt
# would have needed to know a branch already existed.
def "test open issue whose only PR closed unmerged is flagged" [] {
  let found: list<record> = (rule-open-issue-abandoned-pr [(issue 194 OPEN)] [(pr 198 CLOSED "194: keywords")])
  assert equal ($found | get ref) ["#194"]
}

def "test closed PR alongside a merged one is not abandoned" [] {
  let prs: list<record> = [(pr 198 CLOSED "194: try one") (pr 214 MERGED "194: try two")]
  assert equal (rule-open-issue-abandoned-pr [(issue 194 OPEN)] $prs) []
}

# --- duplicate-open-prs / empty-pr / stale-pr -----------------------------------

def "test two open PRs on one issue are flagged" [] {
  let prs: list<record> = [(pr 1 OPEN "264: a") (pr 2 OPEN "264: b")]
  let found: list<record> = (rule-duplicate-open-prs $prs)
  assert equal ($found | get ref) ["#264"]
}

# !292 and !293 sat as zero-file drafts for five weeks, claiming #285/#264.
def "test zero-file open PR is flagged" [] {
  let prs: list<record> = [(pr 293 OPEN "264: locations" --changed 0) (pr 295 OPEN "294: rewards" --changed 16)]
  assert equal (rule-empty-pr $prs | get ref) ["!293"]
}

def "test stale threshold is exclusive of recent PRs" [] {
  let prs: list<record> = [
    (pr 1 OPEN "old" --updated "2026-09-28T00:00:00Z")
    (pr 2 OPEN "fresh" --updated "2026-10-25T00:00:00Z")
    (pr 3 MERGED "old but merged" --updated "2026-01-01T00:00:00Z")
  ]
  assert equal (rule-stale-pr $prs $NOW 14 | get ref) ["!1"]
}

# --- hot-file-collision ---------------------------------------------------------

# #216 (visuals) and #220 (tooling) both edited library/build.ts in parallel and
# #216 reintroduced the console.warn #220 removed — label grouping missed it.
def "test two open PRs on a hot file collide, non-hot overlap does not" [] {
  let prs: list<record> = [
    (pr 216 OPEN "202: render" --files [library/build.ts design/a.py])
    (pr 220 OPEN "213: warnings" --files [library/build.ts design/a.py])
  ]
  let found: list<record> = (rule-hot-file-collision $prs)
  assert equal ($found | get ref) [library/build.ts]
}

# --- roadmap --------------------------------------------------------------------

# #50 had `- [x] #199` while #199 was open — the drift that prompted this rule.
# Later #N on a line (e.g. "(PR #200)") are context, not the item.
def "test roadmap-items takes the first issue number per checklist line" [] {
  let body: string = "- [x] #199 — renderer (PR #200)\n- [ ] #172 — winner\nprose #5"
  assert equal (roadmap-items $body) [{number: 199, checked: true} {number: 172, checked: false}]
}

def "test roadmap checkbox drift in both directions" [] {
  let roadmap: record = {number: 50, milestone: "v0.1-playtest", body: "- [x] #199 — a\n- [ ] #235 — b\n- [ ] #172 — c"}
  let issues: list<record> = [(issue 199 OPEN) (issue 235 CLOSED) (issue 172 OPEN)]
  let found: list<record> = (rule-roadmap-checkbox-drift $roadmap $issues)
  assert equal ($found | get ref | sort) ["#199" "#235"]
}

# #294 was in the milestone but nowhere in #50 — the roadmap's biggest gap.
# A mention anywhere in the body (e.g. the diagram) counts as present.
def "test milestone issue absent from roadmap is flagged" [] {
  let roadmap: record = {number: 50, milestone: "v0.1-playtest", body: "diagram: #276 -> #264"}
  let issues: list<record> = [
    (issue 294 OPEN --milestone "v0.1-playtest")
    (issue 276 OPEN --milestone "v0.1-playtest")
    (issue 247 OPEN)
    (issue 50 OPEN --milestone "v0.1-playtest")
  ]
  assert equal (rule-roadmap-missing-issue $roadmap $issues | get ref) ["#294"]
}

# --- closed-untracked-leftovers -------------------------------------------------

# An unticked item that names its tracking issue (as #199's did after cleanup,
# "→ #207") is accounted for; one that names nothing is a parked gap.
def "test closed-completed with an untracked unticked item is flagged" [] {
  let body: string = "- [x] done\n- [ ] texture pass → #207\n- [ ] fold into template"
  let issues: list<record> = [
    (issue 1 CLOSED --reason COMPLETED --closed "2026-10-20T00:00:00Z" --body $body)
    (issue 2 CLOSED --reason NOT_PLANNED --closed "2026-10-20T00:00:00Z" --body $body)
    (issue 3 CLOSED --reason COMPLETED --closed "2025-01-01T00:00:00Z" --body $body)
  ]
  let found: list<record> = (rule-closed-untracked-leftovers $issues $NOW 90)
  assert equal ($found | get ref) ["#1"]
  assert str contains ($found.0.detail) "1 item"
}

# --- labels / branches ----------------------------------------------------------

def "test open issue without area label is flagged, roadmap exempt" [] {
  let issues: list<record> = [(issue 1 OPEN --labels [bug]) (issue 2 OPEN --labels [cards]) (issue 50 OPEN --labels [documentation])]
  assert equal (rule-missing-area-label $issues 50 | get ref) ["#1"]
}

# library/alpha-1-cards looked "4 ahead" of main because !19 was squash-merged;
# its tip equalled !19's head, so it is merged all the same.
def "test merged branches by ancestry or squash head, open and protected kept" [] {
  let branches: list<record> = [
    {name: "design/all-card-types", sha: "a1", merged_into_main: true}
    {name: "library/alpha-1-cards", sha: "88aa48d", merged_into_main: false}
    {name: "feature/wip", sha: "c3", merged_into_main: false}
    {name: "feature/open", sha: "d4", merged_into_main: true}
    {name: "gh-pages", sha: "e5", merged_into_main: true}
  ]
  let prs: list<record> = [(pr 19 MERGED "alpha-1" --oid "88aa48d") (pr 9 OPEN "x" --head "feature/open")]
  let found: list<record> = (rule-merged-remote-branch $branches $prs)
  assert equal ($found | get ref) ["design/all-card-types" "library/alpha-1-cards"]
}

# --- rendering ------------------------------------------------------------------

# The instruction is the part injected into the agent's context; it must appear
# once per rule with findings, and clean rules must be named in the footer.
def "test markdown carries each rule instruction once" [] {
  let findings: list<record> = [
    {rule: empty-pr, ref: "!1", detail: "a"}
    {rule: empty-pr, ref: "!2", detail: "b"}
  ]
  let md: string = (render-markdown $findings [])
  let rule: record = ($RULES | where id == empty-pr | first)
  assert equal ($md | split row $rule.instruction | length) 2
  assert str contains $md "Clean: open-issue-merged-pr"
}

# Every rule id that run-rules can emit must have an entry in RULES, or its
# findings would silently vanish from the markdown.
def "test every rule function has a RULES entry" [] {
  let ids: list<string> = ($RULES | get id)
  let fns: list<string> = (scope commands | where name =~ '^rule-' | get name | str replace 'rule-' '')
  for f in $fns { assert ($f in $ids) $"($f) has no RULES entry" }
}

def main []: nothing -> nothing {
  let tests: list<string> = (scope commands | where name =~ '^test ' | get name)
  # Names are spliced unquoted into a `nu -c` call, so shell punctuation breaks dispatch.
  let bad: list<string> = ($tests | where {|t| $t =~ `[;'"()|$]` })
  if ($bad | is-not-empty) { error make {msg: $"test names must not contain ; ' \" \( \) | $: ($bad | str join ', ')"} }
  let results: list<record> = ($tests | each {|t|
    let r: record = (try { do { nu-run $t }; {test: $t, ok: true, err: ""} } catch {|e| {test: $t, ok: false, err: $e.msg} })
    $r
  })
  let failed: list<record> = ($results | where not ok)
  $results | each {|r| print $"(if $r.ok { 'ok  ' } else { 'FAIL' }) ($r.test)(if $r.ok { '' } else { $' — ($r.err)' })" }
  print $"\n($results | length) tests, ($failed | length) failed"
  if ($failed | is-not-empty) { exit 1 }
}

def nu-run [name: string]: nothing -> nothing {
  # Commands can't be called by a runtime string, so dispatch through a
  # throwaway nu process that loads this file.
  let r: record = (^$nu.current-exe --no-config-file -c $"source '($env.FILE_PWD)/pm-audit.test.nu'; ($name)" | complete)
  if $r.exit_code != 0 { error make {msg: ($r.stderr | lines | where {|l| $l =~ 'assert|x |left|right|failed|has no' } | str join ' ' | str trim)} }
}
