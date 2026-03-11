# Engine

The game engine processes game logic and manages state. It is a library
imported by clients and the test runner — it has no UI, no network
layer, and no AI logic built in.

## Dependencies

| Package | Purpose |
|---------|---------|
| **immer** | Immutable state with mutable-style code via `produce()`. Proxy-based structural sharing — only changed paths are copied. |
| **pure-rand** | Seeded PRNG with a pure functional API. Returns new RNG state instead of mutating, so RNG state lives inside `GameState` and serializes naturally. Uses **Mersenne Twister** (`prand.mersenne`). |

### Alternatives considered

If automated mass-playthroughs show performance issues with Immer's
proxy overhead, these are drop-in replacements (same `produce()` API):
- **structura.js** — claims 2-5x faster than Immer
- **mutative** — claims 10x faster, optimized for batch operations

No swap needed unless profiling shows Immer is a bottleneck.

## Architecture Decisions

### State Management — Immutable (Redux-style)

Every player action produces a new state object. State is never mutated
in place.

- Use **Immer** for structural sharing and mutable-style code that
  produces immutable results.
- Enables undo, replay, debugging, and save/load by design.
- For automated mass-playthroughs (balance testing), GC pressure from
  object creation is the theoretical concern. Profile before optimizing
  — structural sharing keeps this lightweight for the expected state
  size.

### Randomness — Seeded RNG

All game randomness (shuffles, draws, contests) uses a seeded
pseudo-random number generator. Given the same seed and action sequence,
a game produces identical results.

Uses **pure-rand** with the **Mersenne Twister** algorithm
(`prand.mersenne`). The pure functional API returns a new RNG state with
each draw, so the RNG state is part of `GameState` and
serializes/deserializes with everything else — no separate RNG
restoration logic needed.

```ts
const rng0 = prand.mersenne(gameSeed)
const [value, rng1] = prand.uniformIntDistribution(1, 6, rng0)
// rng1 is stored in GameState
```

This enables:
- **Regression testing**: replay the same game across engine versions.
- **Balance testing**: hold seeds constant, vary card pools or rules.
- **Replay/spectating**: reconstruct a game from seed + action log.

**AI RNG is separate from game RNG.** AI decisions use their own seeded
RNG per player slot, assigned when AI takes control — not at game
creation. This means:
- Changing AI logic doesn't shift the game's random sequence.
- AI can take over any player slot at any time without affecting
  reproducibility.
- Tests control AI seeds independently from game seeds.

### Rules Loading — Baseline Config + Variant Overrides

The engine does not parse rules markdown. Instead, a build step extracts
variant values from the rules files into a config object.

Rules use the format `[var:id:baseline_value]` (e.g.
`[var:starting_gold:10]`). The build step:

1. Extracts all `[var:id:baseline]` declarations from rules markdown.
2. Produces a baseline config: `{ starting_gold: 10, ... }`.
3. For each variant, merges overrides on top of baseline.
4. Errors if the same ID appears with conflicting baseline values.
5. Warns if a variant overrides an ID that doesn't exist in the rules.

The engine receives a plain config object — it never touches markdown.

### Multiplayer — Shared Engine

Each client runs the engine independently. All clients apply the same
actions in the same order, producing identical state (guaranteed by
deterministic engine + seeded RNG).

The architecture supports adding state-hash verification in the future:
after each action, clients could compare state hashes to detect
tampering or desync. This is not implemented initially but the
deterministic design makes it possible without architectural changes.

### Action/Effect System — Simple Dispatch

Card actions map to handler functions via action name. When a player
activates an action, the engine looks up the handler and applies it.

This may evolve into a queue/stack system if timing conflicts arise
(e.g. traps triggering in response to actions, multiple simultaneous
effects). The dispatch interface should be designed to allow this
transition without changing the public API.

### Sessions — Action Log + State Snapshots

Sessions are stored as JSON files. Each session contains the full action
log, which is the source of truth for replaying a game from the start.

```json
{
  "version": "0.1.0",
  "config": { "variant": "baseline" },
  "players": [
    { "id": "p1", "name": "Alice" },
    { "id": "p2", "name": "Bob" }
  ],
  "seed": "abc123",
  "actions": [
    { "turn": 1, "player": "p1", "type": "deploy", "card": "alpha1-u001" },
    { "turn": 1, "player": "p1", "type": "move", "unit": "alpha1-u001", "to": "alpha1-l001" }
  ],
  "result": {
    "winner": "p1",
    "scores": { "p1": 52, "p2": 38 },
    "turns": 18
  }
}
```

**Replay**: feed the seed + config into `createGame`, then `applyAction`
for each action in sequence. The seeded RNG guarantees identical state.

**Quick resume**: optionally include a full `GameState` snapshot in the
session file. This allows loading mid-game without replaying from the
start. The action log remains the canonical record — snapshots are an
optimization.

**Analysis**: session files are queryable with nushell via the
`/session-query` skill for balance testing and game design insights.

### API Surface

The engine exposes a minimal set of pure functions:

```
createGame(config, players, seed) → state
```
Initialize a game. `config` is the resolved variant config. `players`
is a list of player descriptors (id, name). `seed` is the game RNG
seed.

```
getValidActions(state, playerId) → action[]
```
Return all legal actions for a player given the current state. Used by
both human clients (to show available moves) and AI (to choose a move).

```
applyAction(state, action) → { state, events }
```
Apply a player action to the state. Returns the new immutable state and
a list of events describing what happened (for client rendering, logging,
and replay).

```
getVisibleState(state, playerId) → partialState
```
Return a filtered view of the state for a specific player. Hides
information the player shouldn't see (opponent's hand, face-down cards,
prospect deck contents).

**AI uses the same API.** An AI player calls `getValidActions`, scores
the options, picks one, and calls `applyAction`. This means any player
slot can switch between human and AI at any time (e.g. player
disconnect, loading a save state).
