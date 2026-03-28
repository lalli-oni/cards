# Rules Directory

This folder contains markdown files defining the card game rules.

## Instructions
- Focus on game development considerations, not code or implementation (unless specifically asked)
- Be critical and ask questions for clarification
- Only create or modify `.md` files in this directory
- Avoid duplication of rules or definitions across files
- Any values that can be affected by variants: `[var:id:baseline_value]` (e.g. `[var:starting_gold:10]`). The `id` is a human-readable snake_case key for consumers to look up.
- Entire sections that can be replaced by variants: `[var:section-id]` on section headings (e.g. `[var:seeding-phase]`)
- Non-rule content (design comments, interactions to note): `[design:...]`
- When sections become long or overly specific, split into a dedicated `.md` file and add a link in the original

## Key Terminology
- **Deploy** — playing a unit or item from hand to HQ
- **Seeding deck** — the [var:seeding_deck_size:60]-card collection each player brings to the game (16 locations, 16 dilemmas, 28 other)
- **Prospect deck** — personal face-down deck of locations and dilemmas (for grid replacement and dilemma placement)
- **Market deck** — cards available for purchase in the market
- **Main deck** — personal draw deck, seeded from market deck during deck construction
- **Arena** — shared face-up area where exposed cards are placed during draft rounds
- **Claim** — picking a card from the Arena
- **Draft rounds** — the draw/claim rounds within the seeding phase
- **HQ** — player's staging area where units/items enter play

## File Structure
- `README.md` — Master design document (phases, card types, economy, variants)
- `market.md` — Market and economy rules
- `policies.md` — Policy rules, structure, and examples
- `ideas.md` — Feature ideas for post-v1.0 consideration
- Additional rule files are linked from README.md when created

## Open Design Questions
Open design questions are tracked as GitHub issues with the `rules` + `question` labels.
Use `gh issue list -R lalli-oni/cards --label rules,question` to see them.
