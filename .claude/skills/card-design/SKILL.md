---
name: card-design
description: Design new cards with real-world historical references, balanced stats, and rule consistency. Guides thematic selection, stat allocation, and validates against game rules.
---

# Card Design

Design cards that are historically grounded, mechanically sound, and fun to play.

## Arguments
- Free-form description of what cards to design. Examples:
  - "5 common units for alpha-1"
  - "a cunning-focused legendary scientist"
  - "items and events that support a trade strategy"
  - "fill gaps in the alpha-1 set"
- Optional: specific set target (defaults to `alpha-1`)
- Optional: constraints (rarity, type, cost range, theme)

## What Makes a Good Card

### 1. Historical resonance
Every unit is a real historical figure. The card should make someone say "oh, that's clever" — the mechanics should reflect what the person was actually known for.

- **Stats should tell a story.** Cleopatra has 4 strength, 8 cunning, and 9 charisma — she ruled through intellect and diplomacy, not armies. Miyamoto Musashi has 9 strength and 4 charisma — a swordsman, not a diplomat. A card's stat line should be defensible with a one-sentence historical argument.
- **Actions should echo the figure's legacy.** Tesla's action buys items from the market for free (inventions). Musashi duels. Ada Lovelace analyzes (looks at cards). The action name + effect should evoke the person without needing flavor text to explain it.
- **Attributes connect to identity.** Scientist, Warrior, Politician, etc. Pick attributes that reflect what the person *did*, not just who they were. Someone can be Warrior;Politician if they fought and governed.
- **Flavor text is a bonus, not a crutch.** If the card needs flavor text to make thematic sense, the design is weak. Flavor text should add color to an already-clear design.

### 2. Mechanical purpose
Every card should have a reason to exist in a deck.

- **Does it enable a strategy?** Cards should support or reward specific approaches (combat, economy, mission rushing, denial, movement control).
- **Does it have interesting decisions?** The best cards create choice tension — when to play, where to deploy, what to target.
- **Does it interact with other cards?** Look for natural synergies with existing cards. A Scientist unit is better when The Great Library exists. A trade item matters more with The Silk Road.
- **Is it useful at different game stages?** Cheap commons should be relevant early. Expensive legendaries should be worth waiting for. Mid-cost cards should be flexible.

### 3. Stat balance guidelines

#### Units
- **Total stat budget**: Loosely correlates with cost but not strictly. A 3-cost unit might have ~15 total stats, a 7-cost might have ~22. Stat totals are a starting point, not a formula.
- **Specialization over flatness**: A unit with 9/3/3 is more interesting than 5/5/5. Specialists create decisions about where to deploy.
- **Default stat (5) is average**: Stats printed on the card override the default.
- **Strength range**: 2-10. Below 2 is useless in contests; above 10 is format-warping.
- **Cunning range**: 2-10. High cunning enables card draw and information advantage.
- **Charisma range**: 2-10. High charisma wins recruitment contests and social interactions.

#### Cost guidelines
- **0-cost**: Policies (free by design) and locations (placed during seeding, not purchased). No other card type should cost 0 unless there's a strong design reason.
- **1-2 cost**: Commons and cheap uncommons. Simple effects, modest stats.
- **3-4 cost**: Core of most decks. Bread-and-butter units, useful items, tactical events.
- **5-6 cost**: Strong cards with impactful abilities. Epics and some rares.
- **7+ cost**: Build-around legendaries. Should feel like a payoff.

#### Rarity guidelines
- **Common**: Simple, efficient, low decision complexity. The backbone of decks. Limited or no actions.
- **Uncommon**: One interesting mechanic or mild synergy hook. May have a simple action.
- **Epic**: Distinctive ability, clear strategic role. Usually has an action.
- **Legendary**: Unique, build-around potential. High stats or powerful action. Should feel like a centerpiece.

### 4. Historical figure selection

When picking figures for units:

- **Diversity of era and region.** Don't cluster in one time period or geography. Mix ancient, medieval, early modern, modern. Mix continents.
- **Recognizability spectrum.** Include well-known figures (everyone knows Leonardo da Vinci) and interesting obscure ones (fewer know Hypatia or Mansa Musa). The mix creates discovery moments.
- **Avoid figures that are only known for atrocities.** Historical warriors and conquerors are fine (this is a strategy game), but pick figures known for *what they built or achieved*, not solely for destruction.
- **Check for duplication.** Before designing a unit, query existing cards to avoid overlapping figures or nearly-identical stat/action profiles.

### 5. Non-unit cards

- **Locations**: Should reference real places. Mission requirements should connect thematically to the place (The Great Library needs Scientists; The Colosseum needs Warriors). Passive effects should feel like "being at this place helps you do X." Locations can have blocked edges (N, S, E, W) that restrict unit movement — use sparingly to create tactical chokepoints. Locations can also have actions usable by any player with a unit there, using the same `name:ap_cost:effect` format as unit actions.
- **Items**: Can be historical artifacts, inventions, or concepts. Equip effects apply at the equipped unit's location; stored effects apply at the item's location. Items can have both.
- **Events**: Name after historical events, natural phenomena, or strategic concepts. Instant/passive/trap subtype should match the event's nature (an earthquake is instant; a plague is passive; an ambush is a trap).
- **Policies**: Name after real doctrines, philosophies, or economic systems. Effect should be a global modifier that shapes strategy without being mandatory.

## Design Workflow

### Step 1: Assess current set state

Query the existing cards to understand gaps:

```sh
# Card count by type and rarity
nu -c "glob library/sets/alpha-1/*.csv | each { |f| open $f | insert type ($f | path parse | get stem) } | flatten | select type rarity | group-by type | transpose key value | each { |r| { type: $r.key, total: ($r.value | length), rarities: ($r.value | group-by rarity | transpose key value | each { |x| {($x.key): ($x.value | length)} } | into record) } }"
```

Identify:
- Which card types are underrepresented
- Which rarities are missing (especially commons/uncommons)
- Which attributes/keywords lack support
- Which strategies lack cards

### Step 2: Design cards

For each card:
1. Pick the historical reference (for units) or thematic concept (for other types)
2. Assign stats based on the guidelines above and the figure's identity
3. Write the action (if any) — `name:ap_cost:effect` format, where effect is a snake_case identifier (e.g. `strength_contest_injure`, `buy_item_free`, `move_and_gain_gold`)
4. Write card text that explains the mechanic clearly
5. Write flavor text (short, punchy, historically grounded)
6. Assign rarity based on complexity and power level
7. Assign cost based on overall power budget

Present designs as a table matching the CSV columns before writing to files. Always show the full row so the user can review before committing.

### Step 3: Write to CSV

Append new cards to the appropriate CSV file in `library/sets/{set}/`. Use the Edit tool to add rows — do not rewrite the entire file.

Delimiter rules (from `library/schema.md`):
- `;` separates list items (attributes, keywords, actions)
- `|` separates alternative costs
- `:` separates action components (name:ap_cost:effect)
- `>` separates mission requirements from VP reward

### Step 4: Build and validate

Run the build script to check for schema errors:

```sh
bun library/build.ts
```

Fix any validation errors before proceeding.

### Step 5: Rule review

After adding cards, invoke the `/card-rule-review` skill to check consistency with the rules. This catches:
- Keywords that don't exist in the rules
- Action effects that reference undefined mechanics
- Stats or attributes that conflict with rule definitions
- Economy issues (costs that break the gold curve)
- Text that references zones, phases, or concepts incorrectly

If the review flags issues, fix them before considering the cards done.

## Rules
- Never remove or modify existing cards unless explicitly asked
- Always query existing cards before designing to avoid duplication
- Present card designs for user review before writing to CSV
- Run build validation after every CSV edit
- Always end a design session by offering to run `/card-rule-review`
- Use the user's preferred set (default: alpha-1) unless told otherwise
- Respect CSV column order exactly as defined in `library/schema.md`
