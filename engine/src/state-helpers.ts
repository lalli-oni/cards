import type { GameState, GameEvent, LocationCard } from "./types";

export function getPlayer(draft: GameState, playerId: string) {
  const player = draft.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player "${playerId}" not found`);
  }
  return player;
}

export function getConfigNumber(draft: GameState, key: string, defaultValue: number): number {
  const val = draft.config[key];
  return typeof val === "number" ? val : defaultValue;
}

export function placeLocationOnGrid(
  draft: GameState,
  card: LocationCard,
  row: number,
  col: number,
  rotation?: number,
): void {
  if (row < 0 || row >= draft.grid.length || col < 0 || col >= draft.grid[0].length) {
    throw new Error(`Grid position (${row}, ${col}) is out of bounds`);
  }
  if (draft.grid[row][col].location !== null) {
    throw new Error(`Grid position (${row}, ${col}) is already occupied`);
  }

  if (rotation && rotation > 0) {
    const steps = ((rotation % 4) + 4) % 4;
    for (let i = 0; i < steps; i++) {
      const { n, e, s, w } = card.edges;
      card.edges = { n: w, e: n, s: e, w: s };
    }
  }

  draft.grid[row][col].location = card;
}

/** Advance to the next player's turn. Advances round when all players have gone. */
export function advanceTurn(draft: GameState, events: GameEvent[]): void {
  const currentIndex = draft.turnOrder.indexOf(draft.turn.activePlayerId);
  if (currentIndex === -1) {
    throw new Error(
      `Active player "${draft.turn.activePlayerId}" not found in turnOrder ` +
      `[${draft.turnOrder.join(", ")}]`,
    );
  }
  const nextIndex = (currentIndex + 1) % draft.turnOrder.length;

  if (nextIndex === 0) {
    draft.turn.round += 1;
  }

  draft.turn.activePlayerId = draft.turnOrder[nextIndex];
  events.push({
    type: "turn_started",
    playerId: draft.turn.activePlayerId,
    round: draft.turn.round,
  });
}
