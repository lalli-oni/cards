# Design Principles

Meta-level principles that inform game rule design. These are not rules
themselves but guide how rules are created and evaluated.

## Intent

The game should start by **setting up the parameters of play** — seeding
is not mere card distribution but a strategic phase where players make
impactful decisions that shape how the main phase will unfold.

## Parameters of Play

The decisions made during setup should produce meaningful differences in
these dimensions:

- **Immediate capability** — what a player can do on turn 1
- **Strategic trajectory** — what a player is building toward
- **Information landscape** — what players know about each other's plans
- **Board position** — where a player will operate on the grid
- **Resource position** — economic starting state
- **Timing control** — when key cards become available

## Claim Decisions

During the Claim step of each draft round, players pick cards from the
shared Arena. The value of claiming lies in competing priorities — all
resolved by the same action:

- Take a strong unit/item to strengthen your own deck
- Take a mission location and place it near your position for early VP
- Take a blocking-wall location and wall off an opponent's corridor
- Deny a card that looks central to someone's strategy
- Take a card that isn't useful to you but is clearly important to its owner

## No Free Absolutes

A keyword or effect's power should be **conditional or paid-for**, not an
unconditional absolute. Absolutes ("can never be targeted", "always kills")
read as feel-bad on the receiving end and flatten counterplay. Prefer a
condition the opponent can work around, or a cost the owner pays.

[design: This drove two v0.1 keyword choices — Untouchable became *conditional*
(targetable once the attacker out-stats it) rather than blanket-immune, and
Lethal ("always kills") was replaced by Berserker (kills, but the unit injures
itself to do it).]
