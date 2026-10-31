# PM audit: flags GitHub issue/PR/branch states that contradict the project's
# conventions (CLAUDE.md "Branching & WIP discipline", .claude/agents/project-manager.md).
#
# Each rule carries the instruction for acting on its findings, so the output
# doubles as context for the project-manager agent: it reads what to do
# alongside what was found.
#
# Usage:  nu .claude/scripts/pm-audit.nu [--json] [--stale-days 14] [--closed-days 90]
#
# Rules are pure functions over fetched records (see `fetch-*`), so tests feed
# them fixtures: `nu .claude/scripts/pm-audit.test.nu`.

# Keep in sync with CLAUDE.md "Guard the cross-area hot files".
export const HOT_FILES = [
  "library/build.ts"
  "engine/src/keywords.ts"
  "engine/src/types.ts"
]

# An issue body containing `<!-- pm-audit:ack <rule-id> -->` silences that rule
# for that issue — for findings that were judged and deliberately left standing,
# which would otherwise reappear on every run.
const ACK_PATTERN = 'pm-audit:ack\s+(?<rule>[a-z-]+)'

export const AREA_LABELS = [engine client rules visuals tooling cards]

# Branches that are never cleanup candidates.
const PROTECTED_BRANCHES = [main gh-pages HEAD]

export const RULES = [
  {
    id: open-issue-merged-pr
    title: "Open issue whose PR merged"
    instruction: "A PR for this issue merged but the issue is still open. Read the full thread, verify each scope item against the repo, then close it — or make the remaining scope explicit in the body (or split it out). Never close over an untracked leftover. If it stays open deliberately, add `<!-- pm-audit:ack open-issue-merged-pr -->` to the body."
  }
  {
    id: open-issue-abandoned-pr
    title: "Open issue whose only PRs were closed unmerged"
    instruction: "The last implementation attempt was abandoned. Check the branch for salvageable work, record on the issue why the attempt stopped, and make sure the branch is deleted so the next attempt doesn't look like duplicate work. Once recorded, add `<!-- pm-audit:ack open-issue-abandoned-pr -->` to the body."
  }
  {
    id: duplicate-open-prs
    title: "Issue with more than one open PR"
    instruction: "Two open PRs for one issue is the duplicate-implementation signal. Surface it to the user; one PR should be closed."
  }
  {
    id: empty-pr
    title: "Open PR with no changes"
    instruction: "A placeholder PR claims the issue without any work in it, so a real attempt would look like duplicate work. Recommend closing it and deleting the branch unless work starts today (CLAUDE.md: close abandoned PRs the same day)."
  }
  {
    id: stale-pr
    title: "Open PR not updated recently"
    instruction: "Long-lived branches are how fixed things get silently reintroduced. Recommend merging main into it (mandatory if it touches a hot file), landing it, or closing it."
  }
  {
    id: hot-file-collision
    title: "Two open PRs touching the same hot file"
    instruction: "Never run two open PRs over the same hot file (CLAUDE.md). Recommend which lands first; the other waits, then rebases onto it."
  }
  {
    id: roadmap-checkbox-drift
    title: "Roadmap checkbox disagrees with issue state"
    instruction: "Read the issue's full thread first. Then either tick/untick the roadmap item, or (ticked but open) verify the issue is truly done and close it."
  }
  {
    id: roadmap-missing-issue
    title: "Milestone issue missing from the roadmap"
    instruction: "Every issue in the roadmap's milestone belongs in the roadmap: add it to its area section and the dependency diagram — or question whether it belongs in the milestone."
  }
  {
    id: closed-untracked-leftovers
    title: "Closed as completed with unticked items that name no issue"
    instruction: "Read the closing comment — the leftover may be resolved or tracked there. If it isn't, file a follow-up (or ask the user) and point the item at it."
  }
  {
    id: missing-area-label
    title: "Open issue without an area label"
    instruction: "Add at least one area label (engine, client, rules, visuals, tooling, cards) per the label model."
  }
  {
    id: merged-remote-branch
    title: "Remote branch already fully merged"
    instruction: "Its work is in main. Deleting a remote branch is outward-facing: list these for the user and delete only with explicit authorization."
  }
]

def finding [rule: string, ref: string, detail: string]: nothing -> record {
  {rule: $rule, ref: $ref, detail: $detail}
}

def issue-ref [n: int]: nothing -> string { $"#($n)" }
def pr-ref [n: int]: nothing -> string { $"!($n)" }

# Issue numbers a PR is for: GitHub closing references, plus the repo's
# "NNN: title" convention (which also covers multi-issue "284: …; 289: …").
export def pr-issue-numbers [pr: record]: nothing -> list<int> {
  let from_refs: list<int> = ($pr.closingIssuesReferences? | default [] | get -o number | default [])
  let from_title: list<int> = (
    $pr.title | parse --regex '(?:^|[;,]\s*)(?<n>\d+):' | get n | each {|n| $n | into int }
  )
  $from_refs | append $from_title | uniq
}

def prs-for-issue [prs: list<record>, n: int]: nothing -> list<record> {
  $prs | where {|p| $n in (pr-issue-numbers $p) }
}

def has-area-label [issue: record]: nothing -> bool {
  ($issue.labels | any {|l| $l in $AREA_LABELS })
}

export def rule-open-issue-merged-pr [issues: list<record>, prs: list<record>]: nothing -> list<record> {
  $issues
  | where {|i| $i.state == OPEN and ("epic" not-in $i.labels) }
  | each {|i|
      let mine: list<record> = (prs-for-issue $prs $i.number)
      let merged: list<record> = ($mine | where state == MERGED)
      if ($merged | is-not-empty) and ($mine | where state == OPEN | is-empty) {
        let list: string = ($merged | each {|p| pr-ref $p.number } | str join ", ")
        finding open-issue-merged-pr (issue-ref $i.number) $"($i.title) — merged: ($list)"
      }
    }
  | compact
}

export def rule-open-issue-abandoned-pr [issues: list<record>, prs: list<record>]: nothing -> list<record> {
  $issues
  | where state == OPEN
  | each {|i|
      let mine: list<record> = (prs-for-issue $prs $i.number)
      if ($mine | is-not-empty) and ($mine | all {|p| $p.state == CLOSED }) {
        let list: string = ($mine | each {|p| pr-ref $p.number } | str join ", ")
        finding open-issue-abandoned-pr (issue-ref $i.number) $"($i.title) — closed unmerged: ($list)"
      }
    }
  | compact
}

export def rule-duplicate-open-prs [prs: list<record>]: nothing -> list<record> {
  let open: list<record> = ($prs | where state == OPEN)
  $open
  | each {|p| pr-issue-numbers $p | each {|n| {issue: $n, pr: $p.number} } }
  | flatten
  | group-by --to-table issue
  | where {|g| ($g.items | length) > 1 }
  | each {|g|
      let list: string = ($g.items | each {|x| pr-ref $x.pr } | str join ", ")
      finding duplicate-open-prs $"#($g.issue)" $"open PRs: ($list)"
    }
}

export def rule-empty-pr [prs: list<record>]: nothing -> list<record> {
  $prs
  | where state == OPEN and changedFiles == 0
  | each {|p| finding empty-pr (pr-ref $p.number) $"($p.title) — draft: ($p.isDraft), 0 files" }
}

export def rule-stale-pr [prs: list<record>, now: datetime, stale_days: int]: nothing -> list<record> {
  let limit: duration = ($stale_days * 1day)
  $prs
  | where state == OPEN
  | where {|p| ($now - ($p.updatedAt | into datetime)) > $limit }
  | each {|p|
      let age: int = (($now - ($p.updatedAt | into datetime)) / 1day | math floor)
      finding stale-pr (pr-ref $p.number) $"($p.title) — last updated ($age) days ago"
    }
}

# `files` on each open PR is the list of paths it touches.
export def rule-hot-file-collision [prs: list<record>]: nothing -> list<record> {
  let open: list<record> = ($prs | where state == OPEN)
  $HOT_FILES
  | each {|f|
      let touching: list<record> = ($open | where {|p| $f in ($p.files? | default []) })
      if ($touching | length) > 1 {
        let list: string = ($touching | each {|p| pr-ref $p.number } | str join ", ")
        finding hot-file-collision $f $"touched by ($list)"
      }
    }
  | compact
}

# The first `#N` on each checklist line is the item; later ones are context.
export def roadmap-items [body: string]: nothing -> list<record> {
  $body
  | lines
  | parse --regex '^\s*[-*] \[(?<mark>[ xX])\][^#]*#(?<n>\d+)'
  | each {|r| {number: ($r.n | into int), checked: ($r.mark != " ")} }
}

export def rule-roadmap-checkbox-drift [roadmap: record, issues: list<record>]: nothing -> list<record> {
  let by_number: record = ($issues | reduce --fold {} {|i, acc| $acc | insert ($i.number | into string) $i })
  roadmap-items $roadmap.body
  | each {|item|
      let issue: any = ($by_number | get -o ($item.number | into string))
      if $issue == null { null } else if $item.checked and $issue.state == OPEN {
        finding roadmap-checkbox-drift (issue-ref $item.number) $"ticked in #($roadmap.number) but open: ($issue.title)"
      } else if (not $item.checked) and $issue.state == CLOSED {
        finding roadmap-checkbox-drift (issue-ref $item.number) $"unticked in #($roadmap.number) but closed: ($issue.title)"
      }
    }
  | compact
  | uniq-by ref
}

export def rule-roadmap-missing-issue [roadmap: record, issues: list<record>]: nothing -> list<record> {
  if $roadmap.milestone == null { return [] }
  let mentioned: list<int> = ($roadmap.body | parse --regex '#(?<n>\d+)' | get n | each {|n| $n | into int } | uniq)
  $issues
  | where state == OPEN and milestone == $roadmap.milestone and number != $roadmap.number
  | where {|i| $i.number not-in $mentioned }
  | each {|i| finding roadmap-missing-issue (issue-ref $i.number) $"($i.title) — in ($roadmap.milestone), absent from #($roadmap.number)" }
}

export def rule-closed-untracked-leftovers [issues: list<record>, now: datetime, closed_days: int]: nothing -> list<record> {
  let window: duration = ($closed_days * 1day)
  $issues
  | where state == CLOSED and stateReason == COMPLETED and closedAt != null
  | where {|i| ($now - ($i.closedAt | into datetime)) <= $window }
  | each {|i|
      let leftovers: list<string> = (
        $i.body | lines | where {|l| ($l =~ '^\s*[-*] \[ \]') and ($l !~ '#\d+') } | each {|l| $l | str trim }
      )
      if ($leftovers | is-not-empty) {
        let first: string = ($leftovers | first | str substring --grapheme-clusters 0..79)
        finding closed-untracked-leftovers (issue-ref $i.number) $"($i.title) — ($leftovers | length) item\(s\), e.g. `($first)`"
      }
    }
  | compact
}

export def rule-missing-area-label [issues: list<record>, roadmap_number: int]: nothing -> list<record> {
  $issues
  | where state == OPEN and number != $roadmap_number
  | where {|i| not (has-area-label $i) }
  | each {|i|
      let labels: string = (if ($i.labels | is-empty) { "none" } else { $i.labels | str join ", " })
      finding missing-area-label (issue-ref $i.number) $"($i.title) — labels: ($labels)"
    }
}

# `branches`: [{name, sha, merged_into_main: bool}]
export def rule-merged-remote-branch [branches: list<record>, prs: list<record>]: nothing -> list<record> {
  let open_heads: list<string> = ($prs | where state == OPEN | get headRefName)
  let merged_heads: list<string> = ($prs | where state == MERGED | get headRefOid)
  $branches
  | where {|b| $b.name not-in $PROTECTED_BRANCHES and $b.name not-in $open_heads }
  | where {|b| $b.merged_into_main or ($b.sha in $merged_heads) }
  | each {|b|
      let how: string = (if $b.merged_into_main { "tip is in main" } else { "tip is a merged PR's head (squash)" })
      finding merged-remote-branch $b.name $how
    }
}

export def run-rules [data: record, now: datetime, stale_days: int, closed_days: int]: nothing -> list<record> {
  let roadmap: record = $data.roadmap
  [
    (rule-open-issue-merged-pr $data.issues $data.prs)
    (rule-open-issue-abandoned-pr $data.issues $data.prs)
    (rule-duplicate-open-prs $data.prs)
    (rule-empty-pr $data.prs)
    (rule-stale-pr $data.prs $now $stale_days)
    (rule-hot-file-collision $data.prs)
    (rule-roadmap-checkbox-drift $roadmap $data.issues)
    (rule-roadmap-missing-issue $roadmap $data.issues)
    (rule-closed-untracked-leftovers $data.issues $now $closed_days)
    (rule-missing-area-label $data.issues $roadmap.number)
    (rule-merged-remote-branch $data.branches $data.prs)
  ]
  | flatten
  | drop-acked $data.issues
}

export def drop-acked [issues: list<record>]: list<record> -> list<record> {
  let acks: list<string> = (
    $issues
    | each {|i| $i.body | default "" | parse --regex $ACK_PATTERN | get rule | each {|r| $"#($i.number) ($r)" } }
    | flatten
  )
  $in | where {|f| $"($f.ref) ($f.rule)" not-in $acks }
}

export def render-markdown [findings: list<record>, notes: list<string>]: nothing -> string {
  let header: list<string> = ["# PM audit" ""] | append ($notes | each {|n| $"> ($n)" }) | append ""
  let sections: list<string> = (
    $RULES
    | each {|r|
        let hits: list<record> = ($findings | where rule == $r.id)
        if ($hits | is-empty) { null } else {
          [$"## ($r.title) \(($hits | length)\)" "" $"**Do:** ($r.instruction)" ""]
          | append ($hits | each {|h| $"- `($h.ref)` — ($h.detail)" })
          | append ""
        }
      }
    | compact
    | flatten
  )
  let clean: list<string> = ($RULES | where {|r| $r.id not-in ($findings | get -o rule | default []) } | get id)
  let footer: list<string> = (if ($clean | is-empty) { [] } else { [$"Clean: ($clean | str join ', ')"] })
  let body: list<string> = (if ($sections | is-empty) { ["No findings."] } else { $sections })
  $header | append $body | append $footer | str join "\n"
}

# --- Fetching (impure) --------------------------------------------------------

# --wrapped: pass gh's own --flags through instead of parsing them as ours.
def --wrapped gh-json [...args: string]: nothing -> any {
  let r: record = (^gh ...$args | complete)
  if $r.exit_code != 0 { error make {msg: $"gh ($args | str join ' ') failed: ($r.stderr | str trim)"} }
  $r.stdout | from json
}

def fetch-issues []: nothing -> list<record> {
  gh-json issue list --state all --limit 1000 --json number,title,state,stateReason,labels,milestone,body,closedAt
  | each {|i|
      $i
      | update labels { get name }
      | update milestone {|x| $x.milestone?.title? }
      | update stateReason {|x| if ($x.stateReason | is-empty) { null } else { $x.stateReason } }
    }
}

def fetch-prs []: nothing -> list<record> {
  let prs: list<record> = (
    gh-json pr list --state all --limit 1000 --json number,title,state,isDraft,headRefName,headRefOid,updatedAt,changedFiles,closingIssuesReferences
  )
  $prs | each {|p|
    if $p.state == OPEN {
      $p | insert files (gh-json pr view ($p.number | into string) --json files | get files.path)
    } else { $p }
  }
}

def fetch-roadmap []: nothing -> record {
  let repo: record = (gh-json repo view --json owner,name)
  # Concatenated, not interpolated: GraphQL's own parens would be evaluated.
  let q: string = ('{repository(owner:"' + $repo.owner.login + '",name:"' + $repo.name + '"){pinnedIssues(first:10){nodes{issue{number body milestone{title}}}}}}')
  let pinned: list<record> = (gh-json api graphql -f $"query=($q)" | get data.repository.pinnedIssues.nodes.issue)
  # The roadmap is the pinned issue tracking a milestone (PM agent: "Each
  # milestone should have a pinned tracking issue").
  let tracking: list<record> = ($pinned | where milestone != null)
  if ($tracking | is-empty) { return {number: -1, body: "", milestone: null} }
  let r: record = ($tracking | first)
  {number: $r.number, body: $r.body, milestone: $r.milestone.title}
}

def fetch-branches []: nothing -> list<record> {
  ^git fetch --prune --quiet origin
  ^git for-each-ref --format='%(refname:lstrip=3) %(objectname)' refs/remotes/origin
  | lines
  | parse '{name} {sha}'
  | each {|b|
      let merged: bool = ((^git merge-base --is-ancestor $b.sha origin/main | complete).exit_code == 0)
      $b | insert merged_into_main $merged
    }
}

# The pinned version lives in .nu-version at the repo root; the CI and the
# cloud session hook install from it.
def version-note []: nothing -> string {
  let root: string = (^git rev-parse --show-toplevel | str trim)
  let pinned: string = (open --raw ($root | path join .nu-version) | str trim)
  let running: string = (version | get version)
  if $running == $pinned { $"nu ($running) \(pinned\)" } else {
    $"WARNING: running nu ($running) but the repo pins ($pinned) — results may differ"
  }
}

export def main [
  --json                  # Emit findings as JSON instead of markdown
  --stale-days: int = 14  # Open PRs not updated within this many days are flagged
  --closed-days: int = 90 # Look back this far for closed-with-leftovers issues
]: nothing -> any {
  let data: record = {
    issues: (fetch-issues)
    prs: (fetch-prs)
    roadmap: (fetch-roadmap)
    branches: (fetch-branches)
  }
  let findings: list<record> = (run-rules $data (date now) $stale_days $closed_days)
  if $json { return ($findings | to json) }
  let notes: list<string> = [
    (version-note)
    $"Roadmap: #($data.roadmap.number) \(($data.roadmap.milestone)\) · ($data.issues | where state == OPEN | length) open issues · ($data.prs | where state == OPEN | length) open PRs"
  ]
  render-markdown $findings $notes
}
