import { isLegalAction } from "./action-validation";
import { applyAction } from "./apply-action";
import { createGame } from "./create-game";
import type {
  Action,
  GameConfig,
  GameEvent,
  GameState,
  PlayerAdapter,
  PlayerDescriptor,
  Session,
  SetupInput,
} from "./types";
import { getActivePlayerId, getDeciderId } from "./types";
import { getValidActions } from "./valid-actions";
import { getVisibleState } from "./visible-state";

export interface ControllerOptions {
  config: GameConfig;
  players: PlayerDescriptor[];
  seed: string;
  setupInput: SetupInput;
  adapters: Map<string, PlayerAdapter>;
  /** Called after each action is applied. */
  onEvent?: (events: GameEvent[], state: GameState) => void;
  /**
   * Called by `run()` when an adapter submits an action that fails the
   * pre-apply legality gate. Lets an interactive client surface the rejection
   * (and re-prompt the same decider) instead of the loop tearing down. Not
   * invoked on the direct `playTurn()` path — that throws for programmatic
   * callers.
   */
  onInvalidAction?: (error: InvalidActionError, actingPlayerId: string) => void;
}

const DEFAULT_MAX_ACTIONS = 10_000;

/**
 * Upper bound on consecutive rejected submissions for a single decider before
 * `run()` gives up and throws. Not a gameplay limit — a human re-prompts and
 * fixes their input (≤1 rejection in practice) and a bot submits a legal
 * action outright, so this only ever trips on a broken client or a
 * getValidActions/applyAction desync, turning an infinite re-prompt into a
 * clean terminal error.
 */
const MAX_CONSECUTIVE_REJECTIONS = 100;

/**
 * Thrown by `playTurn()` when an adapter returns an action outside the legal
 * set enumerated by `getValidActions`. Typed so `run()` can distinguish a
 * recoverable bad submission (re-prompt) from a genuine engine error (propagate).
 */
export class InvalidActionError extends Error {
  constructor(
    readonly actingPlayerId: string,
    readonly action: Action,
  ) {
    super(
      `Adapter for player "${actingPlayerId}" returned an invalid action: ` +
        `${JSON.stringify(action)}`,
    );
    this.name = "InvalidActionError";
  }
}

/**
 * Orchestrates the game loop. Manages session state, routes turns to
 * player adapters, and builds the action log.
 */
export class GameController {
  private state: GameState;
  private adapters: Map<string, PlayerAdapter>;
  private onEvent?: (events: GameEvent[], state: GameState) => void;
  private onInvalidAction?: (
    error: InvalidActionError,
    actingPlayerId: string,
  ) => void;
  private readonly seed: string;
  private readonly playerDescriptors: PlayerDescriptor[];

  constructor(options: ControllerOptions) {
    this.state = createGame(
      options.config,
      options.players,
      options.seed,
      options.setupInput,
    );
    this.adapters = options.adapters;
    this.onEvent = options.onEvent;
    this.onInvalidAction = options.onInvalidAction;
    this.seed = options.seed;
    this.playerDescriptors = options.players;
  }

  /** Resume a game from a session (replays action log or loads snapshot). */
  static fromSession(
    session: Session,
    setupInput: SetupInput,
    adapters: Map<string, PlayerAdapter>,
    onEvent?: (events: GameEvent[], state: GameState) => void,
    onInvalidAction?: (
      error: InvalidActionError,
      actingPlayerId: string,
    ) => void,
  ): GameController {
    const controller = new GameController({
      config: session.config,
      players: session.players,
      seed: session.seed,
      setupInput,
      adapters,
      onEvent,
      onInvalidAction,
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
    let consecutiveRejections = 0;
    while (this.state.phase !== "ended") {
      if (++actionCount > maxActions) {
        const activePlayer = getActivePlayerId(this.state);
        const round =
          this.state.phase === "main" ? this.state.turn.round : "N/A";
        throw new Error(
          `Game loop exceeded ${maxActions} actions without ending. ` +
            `Phase: "${this.state.phase}", round: ${round}, ` +
            `active player: "${activePlayer}"`,
        );
      }
      try {
        await this.playTurn();
        consecutiveRejections = 0;
      } catch (err) {
        // A rejected submission is recoverable: surface it and re-prompt the
        // same decider on the next iteration (applyAction never ran, so state
        // is unchanged and re-deriving valid actions is sound). Any other error
        // is a genuine engine fault — propagate it unchanged.
        if (!(err instanceof InvalidActionError)) throw err;
        this.onInvalidAction?.(err, err.actingPlayerId);
        if (++consecutiveRejections > MAX_CONSECUTIVE_REJECTIONS) throw err;
      }
    }
    return this.toSession();
  }

  /** Execute a single turn: get action from adapter, validate, apply. */
  async playTurn(): Promise<GameEvent[]> {
    // While a combat is suspended, the pending decision belongs to the prompt's
    // decider (the defender — normally NOT the active player), mirroring the
    // dispatch gate in `apply-action.ts`. Route the turn to that player so we
    // ask their adapter and validate against their action set; the idle
    // attacker's valid-action list is empty while suspended, so driving the loop
    // off the active player would reject the defender's legitimate submission.
    const decider: string | undefined = getDeciderId(this.state);
    const actingPlayerId: string = decider ?? getActivePlayerId(this.state);
    const adapter = this.adapters.get(actingPlayerId);
    if (!adapter) {
      throw new Error(`No adapter registered for player "${actingPlayerId}"`);
    }

    const visibleState = getVisibleState(this.state, actingPlayerId);
    const validActions = getValidActions(this.state, actingPlayerId);
    const action = await adapter.chooseAction(visibleState, validActions);

    // Deep-validate the whole payload against the enumerated legal set, not just
    // type + playerId — a malformed decision payload (bad sit-out ids, wrong
    // matchup pairs, an unoffered kind) must be caught here rather than relied
    // upon applyAction to throw. `run()` treats this as recoverable; direct
    // callers get the throw.
    if (!isLegalAction(action, validActions)) {
      throw new InvalidActionError(actingPlayerId, action);
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
    const round =
      this.state.phase === "main" || this.state.phase === "ended"
        ? this.state.turn.round
        : 0;

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
              rounds: round,
            }
          : undefined,
    };
  }
}
