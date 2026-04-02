import {
  GameController,
  getVisibleState as engineGetVisibleState,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerDescriptor,
  type VisibleState,
} from "cards-engine";
import { HotseatAdapter } from "./HotseatAdapter";
import { DEFAULT_CONFIG, buildSeedingSetup } from "./gameSetup";
import { autoSave, listSessions, loadSession, saveSession } from "./persistence";

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export type Screen = "start" | "playing" | "passDevice";

let _screen = $state<Screen>("start");
let _visibleState = $state<VisibleState | null>(null);
let _validActions = $state<Action[]>([]);
let _eventLog = $state<GameEvent[]>([]);
let _currentPlayerName = $state("");
let _savedSessions = $state<string[]>([]);
let _gamePhase = $state<"seeding" | "main" | "ended" | null>(null);
let _error = $state<string | null>(null);
let _lastTurnStartIndex = $state(0);

export function getScreen() {
  return _screen;
}
export function getVisibleState() {
  return _visibleState;
}
export function getValidActions() {
  return _validActions;
}
export function getEventLog() {
  return _eventLog;
}
export function getCurrentPlayerName() {
  return _currentPlayerName;
}
export function getSavedSessions() {
  return _savedSessions;
}
export function getGamePhase() {
  return _gamePhase;
}
export function getError() {
  return _error;
}
export function getLastTurnEvents() {
  return _eventLog.slice(_lastTurnStartIndex);
}
export function clearError() {
  _error = null;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

class GameAbandoned extends Error {
  constructor() {
    super("Game abandoned");
    this.name = "GameAbandoned";
  }
}

let controller: GameController | null = null;
let players: PlayerDescriptor[] = [];
let resolveAction: ((action: Action) => void) | null = null;
let rejectAction: ((reason: Error) => void) | null = null;
let resolvePassDevice: (() => void) | null = null;
let rejectPassDevice: ((reason: Error) => void) | null = null;
let isFirstTurn = true;
let autoSaveFailCount = 0;

// ---------------------------------------------------------------------------
// Callbacks wired into HotseatAdapter
// ---------------------------------------------------------------------------

function onBeforeTurn(playerId: string): Promise<void> {
  if (isFirstTurn) {
    isFirstTurn = false;
    return Promise.resolve();
  }
  const player = players.find((p) => p.id === playerId);
  _currentPlayerName = player?.name ?? playerId;
  _screen = "passDevice";
  return new Promise<void>((resolve, reject) => {
    resolvePassDevice = resolve;
    rejectPassDevice = reject;
  });
}

function onTurnStart(visibleState: VisibleState, validActions: Action[]): void {
  _visibleState = visibleState;
  _validActions = validActions;
  _gamePhase = visibleState.phase;
  _currentPlayerName =
    players.find((p) => p.id === visibleState.currentPlayerId)?.name ??
    visibleState.currentPlayerId;
  _screen = "playing";
}

function waitForAction(): Promise<Action> {
  return new Promise<Action>((resolve, reject) => {
    resolveAction = resolve;
    rejectAction = reject;
  });
}

function onEvent(events: GameEvent[], state: GameState): void {
  const baseIndex = _eventLog.length;
  _eventLog = [..._eventLog, ...events];
  _gamePhase = state.phase;

  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "turn_started") {
      _lastTurnStartIndex = baseIndex + i;
    }
  }

  if (state.phase === "ended" && players.length > 0) {
    _visibleState = engineGetVisibleState(state, players[0].id);
    _validActions = [];
    _screen = "playing";
  }

  // Auto-save after every action
  if (controller) {
    try {
      const session = controller.toSession(true);
      autoSave(session)
        .then(() => {
          autoSaveFailCount = 0;
        })
        .catch((err) => {
          console.error("Auto-save failed:", err);
          autoSaveFailCount++;
          if (autoSaveFailCount >= 3) {
            _error =
              "Auto-save is failing. Your progress may not be saved. Try saving manually.";
          }
        });
    } catch (err) {
      console.error("Failed to serialize session for auto-save:", err);
    }
  }
}

function handleGameLoopError(err: unknown): void {
  if (err instanceof GameAbandoned) return;
  console.error("Game loop error:", err);
  _error = `The game encountered an error: ${err instanceof Error ? err.message : String(err)}`;
  _screen = "playing";
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

export function startNewGame(
  p1Name: string,
  p2Name: string,
  seed?: string,
): void {
  players = [
    { id: "p1", name: p1Name || "Player 1" },
    { id: "p2", name: p2Name || "Player 2" },
  ];

  const setupInput = buildSeedingSetup(players);
  const gameSeed = seed || crypto.randomUUID();

  const adapters = new Map<string, HotseatAdapter>();
  for (const p of players) {
    adapters.set(
      p.id,
      new HotseatAdapter(onBeforeTurn, onTurnStart, waitForAction),
    );
  }

  _eventLog = [];
  _error = null;
  _gamePhase = "seeding";
  _lastTurnStartIndex = 0;
  isFirstTurn = true;
  autoSaveFailCount = 0;

  controller = new GameController({
    config: DEFAULT_CONFIG,
    players,
    seed: gameSeed,
    setupInput,
    adapters,
    onEvent,
  });

  controller.run().catch(handleGameLoopError);
}

export async function loadGame(key: string): Promise<void> {
  let session;
  try {
    session = await loadSession(key);
  } catch (err) {
    _error = "Failed to load save. Browser storage may be unavailable.";
    console.error("Failed to load session:", key, err);
    return;
  }
  if (!session) {
    _error = `Save "${key}" was not found. It may have been deleted.`;
    return;
  }

  players = session.players;

  let setupInput;
  try {
    setupInput = buildSeedingSetup(players);
  } catch (err) {
    _error = "Failed to initialize card data. Run 'bun library/build.ts' first.";
    console.error("buildSeedingSetup failed:", err);
    return;
  }

  const adapters = new Map<string, HotseatAdapter>();
  for (const p of players) {
    adapters.set(
      p.id,
      new HotseatAdapter(onBeforeTurn, onTurnStart, waitForAction),
    );
  }

  _eventLog = [];
  _error = null;
  _lastTurnStartIndex = 0;
  isFirstTurn = true;
  autoSaveFailCount = 0;

  try {
    controller = GameController.fromSession(
      session,
      setupInput,
      adapters,
      onEvent,
    );
  } catch (err) {
    _error = `Failed to resume game: ${err instanceof Error ? err.message : String(err)}`;
    console.error("fromSession failed:", err);
    return;
  }

  const state = controller.getState();
  _gamePhase = state.phase;

  if (state.phase === "ended" && players.length > 0) {
    _visibleState = engineGetVisibleState(state, players[0].id);
    _screen = "playing";
    return;
  }

  controller.run().catch(handleGameLoopError);
}

export function selectAction(action: Action): void {
  if (resolveAction) {
    const resolve = resolveAction;
    resolveAction = null;
    rejectAction = null;
    resolve(action);
  }
}

export function confirmPassDevice(): void {
  if (resolvePassDevice) {
    const resolve = resolvePassDevice;
    resolvePassDevice = null;
    rejectPassDevice = null;
    resolve();
  }
}

export async function saveGame(name: string): Promise<void> {
  if (!controller) return;
  try {
    await saveSession(name, controller.toSession(true));
    await refreshSessions();
  } catch (err) {
    _error = `Failed to save game: ${err instanceof Error ? err.message : String(err)}`;
    console.error("saveGame failed:", err);
  }
}

export async function refreshSessions(): Promise<void> {
  try {
    _savedSessions = await listSessions();
  } catch (err) {
    console.error("Failed to list sessions:", err);
    _savedSessions = [];
  }
}

export function returnToMenu(): void {
  // Reject pending promises so the game loop terminates cleanly
  const abandon = new GameAbandoned();
  if (rejectAction) {
    rejectAction(abandon);
  }
  if (rejectPassDevice) {
    rejectPassDevice(abandon);
  }

  controller = null;
  _screen = "start";
  _visibleState = null;
  _validActions = [];
  _eventLog = [];
  _lastTurnStartIndex = 0;
  _gamePhase = null;
  _currentPlayerName = "";
  _error = null;
  resolveAction = null;
  rejectAction = null;
  resolvePassDevice = null;
  rejectPassDevice = null;
  autoSaveFailCount = 0;
}
