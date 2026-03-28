# Stat Contests

A stat contest is a 1v1 resolution between two units using a named
stat. Any stat printed on a card can be the basis of a contest (e.g.
strength, cunning, charisma). The unit that initiates the contest is
the **attacker**; the targeted unit is the **defender**.

## Resolution

1. Each unit rolls a d6. **Attack power** = relevant stat + d6 roll.
2. Higher attack power wins. **Ties go to the defender.**
3. The granting card or effect specifies the duration and consequences
   of the contest. Duration tracking follows the same token pattern as
   [passive events](README.md#events) where applicable.

## Consequences

- **Strength contests** have a default consequence: the loser is
  **injured** (see [Unit status](README.md#unit-status)). If the
  winner's attack power is [var:combat_kill_ratio:2]x or more the
  loser's, the loser is **killed** instead. The **Attack** action
  initiates strength contests — see [Combat](README.md#combat) for
  the full multi-unit flow.
- **All other stat contests** have no default consequence. The card or
  effect that initiates the contest defines what happens on win and/or
  loss.

## Modifiers

Stat modifiers from any source (keywords, items, location passives,
injury penalties, etc.) apply to the relevant stat in a contest. A
+2 charisma modifier applies in charisma contests, stat checks, and
any other use of that stat.

Some modifiers are scoped to specific contexts by their own text — for
example, the Fortified keyword grants defending units a strength bonus
"when calculating attack power," which limits it to combat. This
scoping comes from the card or keyword text, not from a blanket rule
about contests.

## Stat contests vs. stat checks

Stat contests (defined here) are 1v1 between two units with dice.
**Stat checks** (used by missions and dilemmas) sum a stat across all
friendly units at a location and compare against a threshold — no dice,
no opposing unit. These are separate mechanics that happen to reference
the same stats.
