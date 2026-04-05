import {
  GameController,
  getVisibleState as engineGetVisibleState,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerDescriptor,
  type VisibleState,
} from "cards-engine";
import { setAutoFreeze } from "cards-engine";
import { HotseatAdapter } from "./HotseatAdapter";
import { DEFAULT_CONFIG, buildSeedingSetup } from "./gameSetup";
import { autoSave, listSessions, loadSession, saveSession } from "./persistence";

// Immer auto-freezes produce() output. Svelte 5's $state uses deep proxies.
// Frozen objects passed into $state (and proxied objects passed back to immer)
// cause conflicts. Disabling auto-freeze avoids the issue entirely.
setAutoFreeze(false);

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
let _prevTurnStartIndex = $state(0);
let _lastTurnStartIndex = $state(0);

export interface CombatOutcome {
  type: "injured" | "killed";
  unitName: string;
  ownerName: string;
}

export interface CombatResult {
  row: number;
  col: number;
  locationName: string;
  attackerName: string;
  defenderName: string;
  outcomes: CombatOutcome[];
  winnerName: string | null;
}

let _combatResult = $state<CombatResult | null>(null);

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
export function getCombatResult() {
  return _combatResult;
}
export function dismissCombat() {
  _combatResult = null;
}
// Derived card name lookup — rebuilt when visible state changes.
// Covers grid, hand, HQ, policies, decks, discard, removed, market,
// middle area, and opponent public zones.
let _cardNameMap = $derived.by(() => {
  const vs = _visibleState;
  if (!vs) return new Map<string, string>();
  const map = new Map<string, string>();
  for (const row of vs.grid) {
    for (const cell of row) {
      if (cell.location) map.set(cell.location.id, cell.location.name);
      for (const u of cell.units) map.set(u.id, u.name);
      for (const i of cell.items) map.set(i.id, i.name);
    }
  }
  const selfZones = [
    vs.self.hand, vs.self.hq, vs.self.activePolicies,
    vs.self.discardPile, vs.self.removedFromGame,
    vs.self.seedingDeck, vs.self.prospectDeck, vs.self.policyPool,
  ];
  for (const zone of selfZones) {
    for (const c of zone) map.set(c.id, c.name);
  }
  for (const c of vs.market) map.set(c.id, c.name);
  for (const c of vs.middleArea) map.set(c.id, c.name);
  for (const opp of vs.opponents ?? []) {
    for (const c of opp.hq) map.set(c.id, c.name);
    for (const c of opp.activePolicies) map.set(c.id, c.name);
  }
  return map;
});

export function resolveCardName(id: string): string {
  return _cardNameMap.get(id) ?? id;
}
export function resolvePlayerName(id: string): string {
  const p = players.find((pl) => pl.id === id);
  return p?.name ?? id;
}
export function getError() {
  return _error;
}
/** Events from the previous turn — shown on the pass-device overlay. */
export function getLastTurnEvents(): GameEvent[] {
  return _eventLog.slice(_prevTurnStartIndex, _lastTurnStartIndex);
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
let lastActivePlayerId: string | null = null;
let autoSaveFailCount = 0;

// ---------------------------------------------------------------------------
// Callbacks wired into HotseatAdapter
// ---------------------------------------------------------------------------

function onBeforeTurn(playerId: string): Promise<void> {
  _combatResult = null; // Clear stale combat results before any turn
  // Only show pass-device overlay when the active player actually changes
  if (playerId === lastActivePlayerId || lastActivePlayerId === null) {
    lastActivePlayerId = playerId;
    return Promise.resolve();
  }
  lastActivePlayerId = playerId;
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
      _prevTurnStartIndex = _lastTurnStartIndex;
      _lastTurnStartIndex = baseIndex + i;
    }
  }

  // Extract combat result for popup. Names are resolved NOW because killed
  // units will be removed from the visible state before the popup renders.
  const combatStart = events.find((e) => e.type === "combat_started");
  if (combatStart && combatStart.type === "combat_started") {
    const combatEnd = events.find((e) => e.type === "combat_resolved");
    if (!combatEnd) {
      console.warn("combat_started without combat_resolved in same event batch");
    }
    const outcomes: CombatOutcome[] = [];
    for (const e of events) {
      if (e.type === "unit_injured") outcomes.push({ type: "injured", unitName: resolveCardName(e.unitId), ownerName: resolvePlayerName(e.ownerId) });
      if (e.type === "unit_killed") outcomes.push({ type: "killed", unitName: resolveCardName(e.unitId), ownerName: resolvePlayerName(e.ownerId) });
    }
    const cell = _visibleState?.grid[combatStart.row]?.[combatStart.col];
    _combatResult = {
      row: combatStart.row,
      col: combatStart.col,
      locationName: cell?.location?.name ?? `(${combatStart.row},${combatStart.col})`,
      attackerName: resolvePlayerName(combatStart.attackerId),
      defenderName: resolvePlayerName(combatStart.defenderId),
      outcomes,
      winnerName: combatEnd?.type === "combat_resolved" && combatEnd.winnerId
        ? resolvePlayerName(combatEnd.winnerId)
        : null,
    };
  }

  if (state.phase === "ended" && players.length > 0) {
    _visibleState = engineGetVisibleState(state, players[0].id);
    _validActions = [];
    _screen = "playing";
  }

  // Auto-save after every action
  if (controller) {
    try {
      const session = structuredClone(controller.toSession(true));
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
      autoSaveFailCount++;
      if (autoSaveFailCount >= 3) {
        _error = "Auto-save is failing. Your progress may not be saved. Try saving manually.";
      }
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
  skipSeeding?: boolean,
): void {
  players = [
    { id: "p1", name: p1Name || "Player 1" },
    { id: "p2", name: p2Name || "Player 2" },
  ];

  const setupInput = buildSeedingSetup(players);
  const gameSeed = seed || crypto.randomUUID();

  const adapters = new Map<string, HotseatAdapter>();
  for (const p of players) {
    const adapter: HotseatAdapter = new HotseatAdapter(onBeforeTurn, onTurnStart, waitForAction);
    if (skipSeeding) adapter.autoSeeding = true;
    adapters.set(p.id, adapter);
  }

  _eventLog = [];
  _error = null;
  _gamePhase = "seeding";
  _prevTurnStartIndex = 0;
  _lastTurnStartIndex = 0;
  _combatResult = null;
  lastActivePlayerId = null;
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
  _prevTurnStartIndex = 0;
  _lastTurnStartIndex = 0;
  _combatResult = null;
  lastActivePlayerId = null;
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
    resolve($state.snapshot(action));
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
  if (!controller) {
    _error = "No active game to save.";
    return;
  }
  try {
    await saveSession(name, structuredClone(controller.toSession(true)));
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
    _error = "Could not load saved games. Browser storage may be unavailable.";
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
  _prevTurnStartIndex = 0;
  _lastTurnStartIndex = 0;
  _combatResult = null;
  _gamePhase = null;
  _currentPlayerName = "";
  _error = null;
  resolveAction = null;
  rejectAction = null;
  resolvePassDevice = null;
  rejectPassDevice = null;
  autoSaveFailCount = 0;
}
