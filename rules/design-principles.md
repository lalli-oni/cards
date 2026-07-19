# Design Principles

Meta-level principles that inform design across the game — its rules and
mechanics, whole sets, and individual cards. These are not rules themselves but
guide how the game is designed and evaluated. (Mechanics-design and card-craft
principles live in the **Mechanics Design** and **Card Craft** sections below.)

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

## Mechanics Design

Principles for designing the game's rules and mechanics themselves — as
distinct from crafting an individual card (see **Card Craft** below) or
composing a whole set (that methodology lives in the `card-set-design` skill).

### Every Mechanic Needs Counterplay

A mechanic the opponent cannot answer removes their decisions and flattens the
game. Each new mechanic should ship with at least one axis of response — a way
to prevent, blunt, race, trade against, or punish it. **No Free Absolutes**
(above) is the keyword-scale case of this same test; apply it equally to whole
subsystems.

### Complexity Budget vs Rules-Surface

Each mechanic spends from a finite pool of rules-surface the player must hold in
their head. A mechanic's true cost is not just its own rules text but every
interaction it opens with the mechanics already present. Reach for a new
mechanic only when an existing one genuinely can't carry the design; prefer
extending established vocabulary over minting new.

### Keyword / DSL-Verb Design: Clear, Reusable, Minimal

Keywords and DSL verbs are the shared vocabulary of the whole set. Keep each one:

- **Clear** — one unambiguous meaning; a reader shouldn't need to guess scope.
- **Reusable** — it earns its place by appearing on many cards, not one; a
  verb built for a single card is flavor text pretending to be a keyword.
- **Minimal** — it does one thing and composes with others, rather than
  bundling several behaviors. A verb that needs a paragraph of exceptions is
  two verbs wearing a trenchcoat.

### Decide the Data Model Before Populating

Settle the schema and vocabulary — attribute lists, category enums, cost/stat
fields, keyword grammar — *before* authoring cards against them. Reworking the
model after hundreds of cards already reference it is expensive and
error-prone.

[design: cf. #160's per-type category-vocabulary governance — the cost of
leaving categories open-ended surfaced only once cards had accumulated against
the loose model.]

### How Mechanics Compose

Design mechanics to combine predictably. Prefer **orthogonal** mechanics — each
operating on a distinct axis (combat, economy, movement, information) — so
their interaction stays legible. Watch for pairs that multiply into unbounded
loops or hard lockouts. A mechanic's value includes the interesting
combinations it opens with what already exists, not only what it does alone.

## Card Craft

Principles for crafting an individual card well. The `card-design` skill is the
working home for card craft and references these principles rather than
restating them; keep the canonical wording here.

### No Dominated / Feel-Bad Cards

No card should be **strictly worse** than another (dominated) — a dominated card
is one nobody plays and a design slot wasted. Equally, avoid **feel-bad** cards:
ones that are unfun to play against out of proportion to the skill needed to
deploy them. Both are failures of the same goal — every card should be a real,
satisfying choice for someone.

### Synergy with Counterplay

Synergies are the reward for deckbuilding, but a synergy that, once assembled,
can no longer be interacted with becomes a solved-puzzle win button. Build
synergies an opponent can still disrupt — deny a piece, race the setup, or
punish the commitment. This is the card-craft echo of **Every Mechanic Needs
Counterplay**.
