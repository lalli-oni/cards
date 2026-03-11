---
name: play-game
description: Play a card game as an AI player. Uses the engine API to reason about game state and make decisions. Useful for early playtesting and discovering AI heuristics.
---

# Play Game

Act as a game player, making decisions through the engine API.

## Arguments
- Optional: game session file to resume from
- Optional: player slot to take (defaults to next player to act)
- Optional: play style hint (e.g. "aggressive", "economy-focused", "mission rush")

## Prerequisites
- Engine must be built and runnable
- A game must be created or in progress

## Steps

### 1. Get the game state

Call `getVisibleState(state, playerId)` to see what the player sees.
Do NOT use full game state — play fair with hidden information.

### 2. Get valid actions

Call `getValidActions(state, playerId)` to see available moves.

### 3. Reason about the decision

Consider:
- **Board state**: what locations are available, what missions are close to completion
- **Economy**: current gold, income, upcoming costs
- **Opponent position**: visible units, completed missions, estimated score
- **Hand options**: what can be deployed, what synergies exist
- **Tempo**: how many turns remain, current score gap

### 4. Pick an action and explain

Choose an action and provide brief reasoning. Format:

```
Turn [N] | AP [remaining] | Gold [amount]
Action: [action type] — [details]
Reasoning: [1-2 sentences on why]
```

### 5. Apply the action

Call `applyAction(state, action)` and repeat from step 1 until the
turn ends or the user interrupts.

## Rules
- Only use `getVisibleState` — never look at hidden information
- Log reasoning for every decision — this is the main value for heuristic discovery
- When a game ends, summarize the strategy that worked or didn't
- Save the session in the standard session JSON format
- If the play style hint conflicts with the optimal play, follow the hint — exploring suboptimal strategies has balance testing value

## Status
**Scaffold only.** This skill cannot run until the engine API is
implemented. Update this file once the engine exposes `createGame`,
`getValidActions`, `applyAction`, and `getVisibleState`.
