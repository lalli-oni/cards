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

export function getPlayerById<P extends { id: string }>(
  state: { players: readonly P[] },
  playerId: string,
): P {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player "${playerId}" not found`);
  }
  return player;
}

/** Get a player's index within the players array, which determines turn order. */
export function getTurnIndex(
  state: { players: readonly { id: string }[] },
  playerId: string,
): number {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx === -1) {
    throw new Error(
      `Player "${playerId}" not found in players ` +
        `[${state.players.map((p) => p.id).join(", ")}]`,
    );
  }
  return idx;
}

/** Get the next player ID in turn order (wrapping). */
export function getNextPlayerId(
  state: { players: readonly { id: string }[] },
  currentId: string,
): string {
  const idx = getTurnIndex(state, currentId);
  return state.players[(idx + 1) % state.players.length].id;
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

/**
 * Advance to the next player's turn. Main-phase only.
 * Increments round when wrapping past the last player back to players[0].
 * Emits turn_started for mid-round advances only; at round boundaries the
 * caller must emit it after checking win conditions.
 *
 * @returns true when a new round begins
 */
export function advanceTurn(
  draft: Draft<MainGameState>,
  events: GameEvent[],
): boolean {
  const nextId = getNextPlayerId(draft, draft.turn.activePlayerId);
  const nextIndex = getTurnIndex(draft, nextId);

  const roundIncremented = nextIndex === 0;
  if (roundIncremented) {
    draft.turn.round += 1;
  }

  draft.turn.activePlayerId = nextId;

  if (!roundIncremented) {
    events.push({
      type: "turn_started",
      playerId: nextId,
      round: draft.turn.round,
    });
  }

  return roundIncremented;
}

/** Advance to the next player in seeding. Emits seeding_player_changed. Does not handle step transitions. */
export function advanceSeedingCursor(
  draft: Draft<SeedingGameState>,
  events: GameEvent[],
): void {
  const seeding = draft.seedingState;
  const nextId = getNextPlayerId(draft, seeding.currentPlayerId);
  seeding.currentPlayerId = nextId;
  events.push({
    type: "seeding_player_changed",
    playerId: nextId,
    step: seeding.step,
  });
}
