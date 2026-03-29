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

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let controller: GameController | null = null;
let players: PlayerDescriptor[] = [];
let resolveAction: ((action: Action) => void) | null = null;
let resolvePassDevice: (() => void) | null = null;
let isFirstTurn = true;

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
  return new Promise<void>((resolve) => {
    resolvePassDevice = resolve;
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
  return new Promise<Action>((resolve) => {
    resolveAction = resolve;
  });
}

function onEvent(events: GameEvent[], state: GameState): void {
  _eventLog = [..._eventLog, ...events];
  _gamePhase = state.phase;

  if (state.phase === "ended") {
    _visibleState = null;
    _validActions = [];
    // Show ended state from the visible-state of the first player
    _visibleState = engineGetVisibleState(state, players[0].id);
    _screen = "playing";
  }

  // Auto-save after every action
  if (controller) {
    autoSave(controller.toSession(true)).catch(console.error);
  }
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
  _gamePhase = "seeding";
  isFirstTurn = true;

  controller = new GameController({
    config: DEFAULT_CONFIG,
    players,
    seed: gameSeed,
    setupInput,
    adapters,
    onEvent,
  });

  // Fire-and-forget: the loop awaits adapter promises
  controller.run().catch((err) => {
    console.error("Game loop error:", err);
  });
}

export async function loadGame(key: string): Promise<void> {
  const session = await loadSession(key);
  if (!session) {
    console.error("Session not found:", key);
    return;
  }

  players = session.players;
  const setupInput = buildSeedingSetup(players);

  const adapters = new Map<string, HotseatAdapter>();
  for (const p of players) {
    adapters.set(
      p.id,
      new HotseatAdapter(onBeforeTurn, onTurnStart, waitForAction),
    );
  }

  _eventLog = [];
  isFirstTurn = true;

  controller = GameController.fromSession(
    session,
    setupInput,
    adapters,
    onEvent,
  );

  const state = controller.getState();
  _gamePhase = state.phase;

  if (state.phase === "ended") {
    _visibleState = engineGetVisibleState(state, players[0].id);
    _screen = "playing";
    return;
  }

  // Resume game loop
  controller.run().catch((err) => {
    console.error("Game loop error:", err);
  });
}

export function selectAction(action: Action): void {
  if (resolveAction) {
    const resolve = resolveAction;
    resolveAction = null;
    resolve(action);
  }
}

export function confirmPassDevice(): void {
  if (resolvePassDevice) {
    const resolve = resolvePassDevice;
    resolvePassDevice = null;
    resolve();
  }
}

export async function saveGame(name: string): Promise<void> {
  if (!controller) return;
  await saveSession(name, controller.toSession(true));
  await refreshSessions();
}

export async function refreshSessions(): Promise<void> {
  _savedSessions = await listSessions();
}

export function returnToMenu(): void {
  controller = null;
  _screen = "start";
  _visibleState = null;
  _validActions = [];
  _eventLog = [];
  _gamePhase = null;
  _currentPlayerName = "";
  resolveAction = null;
  resolvePassDevice = null;
}
