import type {
  GameConfig,
  GameState,
  PlayerDescriptor,
  PlayerAdapter,
  Action,
  GameEvent,
  Session,
} from "./types";
import { createGame } from "./create-game";
import { getValidActions } from "./valid-actions";
import { applyAction } from "./apply-action";
import { getVisibleState } from "./visible-state";

export interface ControllerOptions {
  config: GameConfig;
  players: PlayerDescriptor[];
  seed: string;
  adapters: Map<string, PlayerAdapter>;
  /** Called after each action is applied. */
  onEvent?: (events: GameEvent[], state: GameState) => void;
}

const DEFAULT_MAX_ACTIONS = 10_000;

/**
 * Orchestrates the game loop. Manages session state, routes turns to
 * player adapters, and builds the action log.
 */
export class GameController {
  private state: GameState;
  private adapters: Map<string, PlayerAdapter>;
  private onEvent?: (events: GameEvent[], state: GameState) => void;
  private readonly seed: string;
  private readonly playerDescriptors: PlayerDescriptor[];

  constructor(options: ControllerOptions) {
    this.state = createGame(options.config, options.players, options.seed);
    this.adapters = options.adapters;
    this.onEvent = options.onEvent;
    this.seed = options.seed;
    this.playerDescriptors = options.players;
  }

  /** Resume a game from a session (replays action log or loads snapshot). */
  static fromSession(
    session: Session,
    adapters: Map<string, PlayerAdapter>,
    onEvent?: (events: GameEvent[], state: GameState) => void,
  ): GameController {
    const controller = new GameController({
      config: session.config,
      players: session.players,
      seed: session.seed,
      adapters,
      onEvent,
    });

    if (session.snapshot) {
      // Quick resume from snapshot
      controller.state = session.snapshot;
    } else {
      // Replay action log
      for (let i = 0; i < session.actions.length; i++) {
        const action = session.actions[i];
        try {
          const { state, events } = applyAction(controller.state, action);
          controller.state = state;
          controller.onEvent?.(events, state);
        } catch (err) {
          throw new Error(
            `Session replay failed at action ${i + 1}/${session.actions.length} ` +
            `(type: "${action.type}", player: "${action.playerId}"): ` +
            `${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    return controller;
  }

  /** Run the game loop until the game ends. */
  async run(maxActions = DEFAULT_MAX_ACTIONS): Promise<Session> {
    let actionCount = 0;
    while (this.state.phase !== "ended") {
      if (++actionCount > maxActions) {
        throw new Error(
          `Game loop exceeded ${maxActions} actions without ending. ` +
          `Phase: "${this.state.phase}", round: ${this.state.turn.round}, ` +
          `active player: "${this.state.turn.activePlayerId}"`,
        );
      }
      await this.playTurn();
    }
    return this.toSession();
  }

  /** Execute a single turn: get action from adapter, validate, apply. */
  async playTurn(): Promise<GameEvent[]> {
    const { activePlayerId } = this.state.turn;
    const adapter = this.adapters.get(activePlayerId);
    if (!adapter) {
      throw new Error(
        `No adapter registered for player "${activePlayerId}"`,
      );
    }

    const visibleState = getVisibleState(this.state, activePlayerId);
    const validActions = getValidActions(this.state, activePlayerId);
    const action = await adapter.chooseAction(visibleState, validActions);

    // Validate the adapter returned a legal action
    const isValid = validActions.some(
      (va) => va.type === action.type && va.playerId === action.playerId,
    );
    if (!isValid) {
      throw new Error(
        `Adapter for player "${activePlayerId}" returned an invalid action: ` +
        `${JSON.stringify(action)}`,
      );
    }

    return this.applyAction(action);
  }

  /** Apply an action directly (for programmatic use / replay). */
  applyAction(action: Action): GameEvent[] {
    const result = applyAction(this.state, action);
    this.state = result.state;
    this.onEvent?.(result.events, this.state);
    return result.events;
  }

  /** Get the current game state. */
  getState(): GameState {
    return this.state;
  }

  /** Serialize the current game as a session. */
  toSession(includeSnapshot = false): Session {
    return {
      version: "0.1.0",
      config: this.state.config,
      players: this.playerDescriptors,
      seed: this.seed,
      actions: this.state.actionLog,
      snapshot: includeSnapshot ? this.state : undefined,
      result:
        this.state.phase === "ended"
          ? {
              winner: this.state.winner,
              scores: this.state.scores ?? {},
              rounds: this.state.turn.round,
            }
          : undefined,
    };
  }
}
