# Card Game Project

## Overview
A collectible card game with decoupled architecture: rules (markdown) -> engine -> clients/test/library.

See [README.md](README.md) for full project structure.

## Terminology

Use canonical terms from `rules/README.md`. If the user uses informal or ambiguous terms (e.g. "location deck" instead of "prospect deck", "board" instead of "grid", "base" instead of "HQ"), gently note the correct term from the rules. When a term like "deck" is ambiguous, ask which one (main deck, market deck, prospect deck, seeding deck).

## Project Management

Route routine issue work to the **`project-manager` subagent** — picking what to work on next, status reports, triage, labelling, sub-issue creation, and roadmap updates. The agent owns the label model, sub-issue workflow, and the "issues as living documents" convention; consult its definition (`.claude/agents/project-manager.md`) for current conventions rather than improvising.

**Epics vs milestones** are orthogonal: milestones = "what's in this release," epics = "what thematic body of work" (e.g. #45 = content/balance, #210 = rules-architecture). Route epic/milestone decisions through the `project-manager` subagent — see its `### Epics` and `### Milestones` sections. When a future milestone is deliberately deferred, a themed epic may hold post-milestone issues **within its own theme only**; everything else stays unmilestoned/backlog.

## Design Discussions

When an **open design question** needs deliberating — surfacing tradeoffs, pushing back on premature decisions, and capturing the outcome to an issue — route it to the **`design-facilitator` subagent**. It facilitates the decision, then hands off: execution goes to the `card-design` / `card-set-design` skills (card/set craft) or back to the main session (rules edits), and issue mechanics (labels, sub-issues, closing) go to `project-manager`. It references `rules/design-principles.md` rather than restating principles. This is distinct from `project-manager` (what/why/order, not the design itself) and from the design *skills* (which execute a settled design rather than deliberate an open one).

## Branching & WIP discipline

Most rework here has come from concurrent long-lived branches colliding on the same files — one PR reintroducing or clobbering another's work, or one issue implemented twice. The existing defence is the PM agent's **Issue Grouping** rule: group work by shared *area label* (`engine`, `client`, `rules`, `visuals`, `tooling`, `cards`). Extend it with:

- **Prefer one open PR per area label at a time**, and sequence dependent work as a chain rather than fanning out parallel branches on the same area.
- **Guard the cross-area hot files.** Some work spans several area labels, so label-grouping alone won't catch the collision: the keyword → build → render pipeline (`library/build.ts`, `engine/src/keywords.ts`, `engine/src/types.ts`) is edited by `cards`, `engine`, `visuals`, and `tooling` work alike. Never run two open PRs that touch the same hot file — the second waits for the first to land, then rebases onto it. (This is exactly how #216, a `visuals` PR, came to reintroduce the `console.warn` that #220, a `tooling`/`cards` PR, was simultaneously removing.)
- **Branch from the tip you depend on; rebase daily.** If your work needs another PR's changes, branch *after* it merges. Any branch alive more than 2–3 days over a hot file merges `main` before further work — a stale branch is exactly how a just-fixed thing gets silently reintroduced.
- **Settle the design before opening an implementation PR** for keystone issues — put the decision in an issue comment first (see the PM agent's "issues as living documents"), don't discover it mid-branch. Repeated abandon-and-restart on one issue is the signal this was skipped.
- **Keep PRs small and short-lived on shared files.** Large PRs over hot files can't be reconciled in parallel; small ones merge before an overlap window opens.
- **Before starting an issue, check for an existing branch/PR on it** (`gh pr list --search "<issue#> in:title" --state all`, `git branch -a --list '*<issue#>*'`). Two branches for one issue means duplicate work.
- **Close abandoned PRs and delete their branches the same day**; don't leave draft PRs dangling. Run `/cleanup` routinely, not just as a rescue — stale branches/worktrees are what make "is this merged?" ambiguous.

## Code Style
- Always use explicit TypeScript type annotations for readability — variables, parameters, return types, reactive declarations
- Avoid Svelte `{@html}` — return structured data and render with `{#each}` or components instead

## Key Conventions
- `rules/` contains only markdown files defining game rules — no code
- Variant-dependent values use `[var:id:baseline_value]` format (e.g. `[var:starting_gold:10]` means the baseline value is 10, keyed by `starting_gold`)
- Design commentary uses `[design:...]` format
- Avoid duplication of rules across files; link instead
- When rule sections grow long, split into a dedicated file and link from the parent

## Architecture

Monorepo with bun workspaces. Single version (`package.json` root). Rules and library are data directories (no package.json); engine, clients, and test are workspaces.

- **rules/**: Baseline rules in markdown. Variants override baseline values. Loaded by engine.
- **engine/**: (`cards-engine`) Game engine. Processes logic, manages state. Workspace package imported by clients and test.
- **library/**: Card definitions as CSV, built to JSON. See `library/schema.md` for column specs.
- **clients/**: Game clients (web app, card design tool, etc.). Each client is a workspace.
- **test/**: (`cards-test`) Test runner and balance testing. Imports `cards-engine`.

## Card Library

- Cards are stored as **CSV files** in `library/sets/{set_name}/` — one file per card type
- Build to JSON with `bun library/build.ts` (output in `library/build/`, gitignored)
- Schema and column definitions are in `library/schema.md`
- ID format: kebab-case of card name (e.g. `cleopatra`, `investment-banking`). Globally unique.
- Card types: unit, location, item, event, policy
- Delimiters within fields: `;` for lists, `|` for alternative costs, `:` for action components
- When adding cards, always run the build script to validate
- New sets: create a new directory under `library/sets/` with the same CSV structure

### Workflows
- **Editing**: Use VisiData (`vd library/sets/baseline/units.csv`) for terminal spreadsheet editing, or Numbers/Excel for bulk sessions
- **Querying**: Use `/card-query` skill to query card data with nushell
- **Building**: Run `bun library/build.ts` after edits to validate and generate JSON
