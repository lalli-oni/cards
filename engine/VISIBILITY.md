# Visibility borders

A **living, non-exhaustive** reference for what information each player can and
cannot see. It exists so that card design (and client work) can reason about
visibility without reverse-engineering the filter every time. When in doubt, the
**source of truth is `getVisibleState` in `engine/src/visible-state.ts`** — this
doc summarizes it, it does not replace it. If you change the filter, update this
file in the same PR.

Card designers: if a card wants to *leverage* visibility (reveal hidden
information, or hide something normally public), start here to see where the
current borders are, then wire it through the `reveals` provider (see
[Bending the borders](#bending-the-borders)).

---

## The three tiers

Every field on `VisibleState` falls into one of three tiers:

| Tier | Who sees it | Examples |
|------|-------------|----------|
| **Public** | every viewer, unredacted | grid, market, turn, scores, **combatPrompt** |
| **Private** | only the acting player | `pickPrompt` (the picker), `viewPrompt` (the viewer) |
| **Redacted** | shape/counts public, contents hidden per-viewer | opponent hands, decks, face-down traps |

Teammates are treated as **self** — they share full visibility (see
`isTeammate` in `visible-state.ts`).

---

## Surface-by-surface

### Public — all viewers, unredacted
- `config`, `phase`, `turn`, `currentPlayerId`, `turnOrder`
- `grid` — the whole board, including every unit/item/location on it
- `market`
- `winner`, `scores` (ended phase)
- `middleArea`, `seedingStep` (seeding phase)
- **`combatPrompt`** — combat is fully open information. When a combat suspends
  between rounds (#165), *every* viewer sees the full prompt (cell, round,
  committed unit-id lists, and which player must decide). This is deliberately
  unlike `pickPrompt`/`viewPrompt`. Rationale: the units in the prompt are
  already on the public grid, so nothing new leaks — and both sides watching a
  fight need to see it pause. See #165, and #166–#168 for the decisions that
  will drive real pauses.

### Private — only the acting player
- `pickPrompt` — surfaced **only** to `pickPrompt.playerId`. A `peek()`'s
  candidate cards must not leak to opponents. Present in both main and seeding
  (e.g. Scholar's top-5 reorder).
- `viewPrompt` — surfaced **only** to `viewPrompt.playerId`. Carries opponent
  hand contents captured by `peek(opponent + hand)`; leaking it would defeat the
  hidden-hand rule.

### Redacted — counts public, contents hidden (`toOpponentView`)
For every opponent, these are reduced to sizes/counts, not contents:
- `hand` → `handSize`
- `seedingDeck` / `mainDeck` / `marketDeck` / `prospectDeck` / `discardPile`
  → `*Size` counts only
Still public for opponents: `gold`, `vp`, `hq`, `activePolicies`,
`passiveEvents`, and `activeTraps` (redacted — see below).

`self` and `teammates` are returned as **full `PlayerState`** — no redaction.

### Face-down traps
`activeTraps` are visible as *existence + target* (`TrapView` = `{ targetId,
cardId }`) but the **card contents are redacted** unless the viewer has explicit
reveal rights for that trap (`redactTrap`). Rights come from the reveal system
below.

---

## Bending the borders

Cards change visibility through a **`reveals` provider** — an optional function a
card's effect factory returns, shaped `(state, viewerId) => Partial<Reveals>`.
`computeReveals` walks every active card (grid + per-player surfaces) and merges
the contributions for the specific viewer. Two levers exist today:

- **`mainDeckTop`** — expose the top card of a main deck to a viewer. Example:
  *Alexandria Harbor* reveals the owner's own top card. At most one provider may
  set `mainDeckTop` per viewer (conflicts **throw**, they are not silently
  merged).
- **`revealedTrapIds`** — grant a viewer the right to see specific face-down
  traps' contents (deduped across providers).

```
card effect factory ──returns──▶ reveals?: (state, viewerId) => Partial<Reveals>
                                      │
                        computeReveals merges per viewer
                                      │
                                      ▼
              VisibleState.reveals  +  trap redaction rights
```

If you need a *new* kind of reveal (e.g. "see an opponent's hand", "hide a unit
on the grid"), that is a change to the `Reveals` type and the filter, not just a
card — extend `Reveals`, teach `getVisibleState`/`computeReveals` to honor it,
and document the new border here.

---

## Known gaps / not-yet-modeled
- No mechanism to **hide** something that is otherwise public (e.g. a cloaked
  unit on the grid) — the grid is all-or-nothing public today.
- No per-viewer redaction of `market` or `hq`.
- Multi-opponent `peek` target selection is not implemented — `viewPrompt`
  currently targets the first non-active player deterministically.

Add rows here as new borders (or gaps) are discovered.
