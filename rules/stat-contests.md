# Stat Contests

A stat contest is a 1v1 resolution between two units using a named
stat. Any stat printed on a card can be the basis of a contest (e.g.
strength, cunning, charisma).

## Resolution

1. **Initiator** and **target** are determined by the action or effect
   that triggers the contest.
2. Each unit rolls a d6. Contest power = relevant stat + d6 roll.
3. Higher contest power wins. **Ties go to the target** (the defending
   unit).

## Consequences

- **Strength contests** have a default consequence: the loser is
  **injured** (see Unit status). If the winner's contest power is
  [var:combat_kill_ratio:2]x or more the loser's, the loser is
  **killed** instead. The **Attack** action initiates strength contests
  — see Combat for the full multi-unit flow.
- **All other stat contests** have no default consequence. The card or
  effect that initiates the contest defines what happens on win and/or
  loss.

## Initiating a contest

- Strength contests are initiated by the **Attack** core action. Each
  1v1 matchup pair in combat resolves as a strength contest (see
  Combat).
- Non-strength contests are **never core actions**. They are only
  initiated by card effects (unit actions, events, etc.). The card
  specifies the stat used and the consequences.

## Modifiers

Stat modifiers from any source (keywords, items, location passives,
injury penalties, etc.) apply to the relevant stat in a contest. A
modifier that grants +2 charisma applies whether the unit is in a
charisma contest, contributing to a stat check, or any other use of
that stat.

Some modifiers are scoped to specific contexts by their own text — for
example, the Fortified keyword grants a strength bonus "when
calculating attack power," which limits it to combat. This scoping
comes from the card or keyword text, not from a blanket rule about
contests.

## Stat contests vs. stat checks

Stat contests (defined here) are 1v1 between two units with dice.
**Stat checks** (used by missions and dilemmas) sum a stat across all
friendly units at a location and compare against a threshold — no dice,
no opposing unit. These are separate mechanics that happen to reference
the same stats.
