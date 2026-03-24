import type { Draft } from "immer";
import type {
  GameEvent,
  LocationCard,
  MainGameState,
  SeedingGameState,
} from "./types";

/**
 * These helpers use structural typing for their parameters so they accept
 * both GameState and Draft<GameState>. This avoids Immer draft incompatibility
 * caused by variadic tuple types (e.g. attack.unitIds) elsewhere in the state.
 */

export function getPlayer<P extends { id: string }>(
  state: { players: readonly P[] },
  playerId: string,
): P {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player "${playerId}" not found`);
  }
  return player;
}

export function getConfigNumber(
  state: { config: Record<string, unknown> },
  key: string,
  defaultValue: number,
): number {
  const val = state.config[key];
  if (val === undefined) return defaultValue;
  if (typeof val !== "number") {
    throw new Error(
      `Config "${key}" expected number, got ${typeof val}: ${JSON.stringify(val)}`,
    );
  }
  return val;
}

export function placeLocationOnGrid(
  draft: { grid: { location: LocationCard | null }[][] },
  card: LocationCard,
  row: number,
  col: number,
  rotation?: number,
): void {
  if (
    row < 0 ||
    row >= draft.grid.length ||
    col < 0 ||
    col >= draft.grid[0].length
  ) {
    throw new Error(`Grid position (${row}, ${col}) is out of bounds`);
  }
  if (draft.grid[row][col].location !== null) {
    throw new Error(`Grid position (${row}, ${col}) is already occupied`);
  }

  if (rotation) {
    const steps = ((rotation % 4) + 4) % 4;
    for (let i = 0; i < steps; i++) {
      const { n, e, s, w } = card.edges;
      card.edges = { n: w, e: n, s: e, w: s };
    }
  }

  draft.grid[row][col].location = card;
}

/** Advance to the next player's turn. Main-phase only. Advances round when all players have gone. */
export function advanceTurn(
  draft: Draft<MainGameState>,
  events: GameEvent[],
): void {
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

/** Advance to the next player in seeding. Emits seeding_player_changed. */
export function advanceSeedingCursor(
  draft: Draft<SeedingGameState>,
  events: GameEvent[],
): void {
  const seeding = draft.seedingState;
  const idx = draft.turnOrder.indexOf(seeding.currentPlayerId);
  if (idx === -1) {
    throw new Error(
      `Seeding active player "${seeding.currentPlayerId}" not found in turnOrder ` +
        `[${draft.turnOrder.join(", ")}]`,
    );
  }
  const next = (idx + 1) % draft.turnOrder.length;
  seeding.currentPlayerId = draft.turnOrder[next];
  events.push({
    type: "seeding_player_changed",
    playerId: seeding.currentPlayerId,
    step: seeding.step,
  });
}
