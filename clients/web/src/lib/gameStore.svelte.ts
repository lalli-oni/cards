import {
  GameController,
  getVisibleEvent,
  getVisibleState as engineGetVisibleState,
  type Action,
  type ActionDef,
  type Card,
  type GameEvent,
  type GameState,
  type PlayerDescriptor,
  type VisibleState,
} from "cards-engine";
import { setAutoFreeze } from "cards-engine";
import { HotseatAdapter } from "./HotseatAdapter";
import { DEFAULT_CONFIG, buildSeedingSetup, buildMainSetup } from "./gameSetup";
import { autoSave, listSessions, loadSession, saveSession } from "./persistence";
import { buildPairDetail, type PairDetail } from "./contestResult";

export type { PairDetail, PairSideView } from "./contestResult";

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
// Pending viewer for the pass-device overlay. Set in onBeforeTurn (when the
// new player's id is known) and cleared in onTurnStart (after _visibleState
// catches up to the new player's view). The overlay's recap must project
// for this id, not _visibleState.playerId, which still holds the OUTGOING
// player's view during the overlay screen.
let _incomingPlayerId = $state<string | null>(null);

export interface ContestOutcome {
  type: "injured" | "killed";
  unitName: string;
  ownerName: string;
}

export interface ContestResult {
  row: number;
  col: number;
  locationName: string;
  attackerName: string;
  defenderName: string;
  pairs: PairDetail[];
  outcomes: ContestOutcome[];
  winnerName: string | null;
}

let _contestResult = $state<ContestResult | null>(null);

export function getScreen() {
  return _screen;
}
export function getVisibleState() {
  return _visibleState;
}
export function getValidActions() {
  return _validActions;
}
export function getEventLog(): GameEvent[] {
  // Raw events stay in `_eventLog` (god-view). Project to the current viewer
  // here so per-viewer-private fields (e.g. `card_drawn.cardId`) are stripped
  // for non-owners. On device-pass the viewer changes, this re-derives, and
  // historical entries are re-projected from the new viewer's POV — no leak
  // of the previous player's drawn-card identities.
  const viewerId = _visibleState?.playerId;
  if (!viewerId) return _eventLog;
  return _eventLog.map((e) => getVisibleEvent(e, viewerId));
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
export function getContestResult() {
  return _contestResult;
}
export function dismissContest() {
  _contestResult = null;
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

/** Name of the location at (row, col), or null if the cell has no location. */
export function resolveCellName(row: number, col: number): string | null {
  const cell = _visibleState?.grid[row]?.[col];
  return cell?.location?.name ?? null;
}

/**
 * Tooltip text for an `activate` action — looks up the source card and its
 * named action. For policies, `action.effect` is human-readable prose. For
 * units/items, the action `effect` is DSL, so we fall back to the card's
 * `text` field which carries the player-facing description.
 */
export function resolveActionTooltip(action: Action): string | undefined {
  if (action.type === "destroy") {
    return "Permanently removes the card from the game (not the discard pile).";
  }
  if (action.type !== "activate") return undefined;
  const vs = _visibleState;
  if (!vs) return undefined;
  const zones: Card[][] = [
    vs.self.hq as Card[],
    vs.self.activePolicies as Card[],
    ...vs.grid.flatMap((row) =>
      row.flatMap((cell): Card[][] => [
        cell.units as Card[],
        cell.items as Card[],
        cell.location ? [cell.location as Card] : [],
      ]),
    ),
  ];
  for (const zone of zones) {
    for (const card of zone) {
      if (card.id !== action.cardId) continue;
      const actions: ActionDef[] | undefined =
        "actions" in card ? card.actions : undefined;
      const def = actions?.find((a) => a.name === action.actionName);
      // Policies: action.effect is human-readable prose. Units/items: card.text
      // is the player-facing description (action.effect is DSL).
      if (card.type === "policy") return def?.effect ?? card.text ?? undefined;
      return card.text ?? undefined;
    }
  }
  return undefined;
}
export function resolvePlayerName(id: string): string {
  const p = players.find((pl) => pl.id === id);
  return p?.name ?? id;
}
export function getError() {
  return _error;
}
/** Events from the previous turn — shown on the pass-device overlay.
 *  Projected for the INCOMING player (who is about to read the recap),
 *  not `_visibleState.playerId` which still holds the outgoing player's
 *  view at overlay time. Falls back to `_visibleState.playerId` outside
 *  the pass-device flow. */
export function getLastTurnEvents(): GameEvent[] {
  const slice = _eventLog.slice(_prevTurnStartIndex, _lastTurnStartIndex);
  const viewerId = _incomingPlayerId ?? _visibleState?.playerId;
  return viewerId ? slice.map((e) => getVisibleEvent(e, viewerId)) : slice;
}
export function clearError() {
  _error = null;
}
// Minimal v0.1 export so components can surface engine/client invariant
// violations via the shared banner. #110 tracks proper error-handling infra
// (consolidated setError, structured logError helper, severity levels).
export function setError(message: string): void {
  _error = message;
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
  // Only show pass-device overlay when the active player actually changes
  if (playerId === lastActivePlayerId || lastActivePlayerId === null) {
    lastActivePlayerId = playerId;
    return Promise.resolve();
  }
  lastActivePlayerId = playerId;
  _contestResult = null; // Clear stale combat results on player change
  const player = players.find((p) => p.id === playerId);
  _currentPlayerName = player?.name ?? playerId;
  _incomingPlayerId = playerId;
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
  _incomingPlayerId = null;
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
      _error = "Combat resolution incomplete (missing combat_resolved event). Some outcomes may be missing from the dialog.";
    }
    const outcomes: ContestOutcome[] = [];
    const pairs: PairDetail[] = [];
    for (const e of events) {
      if (e.type === "unit_injured") {
        outcomes.push({ type: "injured", unitName: resolveCardName(e.unitId), ownerName: resolvePlayerName(e.controllerId) });
      } else if (e.type === "unit_killed") {
        outcomes.push({ type: "killed", unitName: resolveCardName(e.unitId), ownerName: resolvePlayerName(e.controllerId) });
      } else if (e.type === "combat_pair_resolved") {
        pairs.push(buildPairDetail(e, { card: resolveCardName, player: resolvePlayerName }));
      }
    }
    const cell = _visibleState?.grid[combatStart.row]?.[combatStart.col];
    _contestResult = {
      row: combatStart.row,
      col: combatStart.col,
      locationName: cell?.location?.name ?? `(${combatStart.row},${combatStart.col})`,
      attackerName: resolvePlayerName(combatStart.attackerId),
      defenderName: resolvePlayerName(combatStart.defenderId),
      pairs,
      outcomes,
      winnerName: combatEnd?.type === "combat_resolved" && combatEnd.winnerId
        ? resolvePlayerName(combatEnd.winnerId)
        : null,
    };
  } else {
    // Orphan-pair guard: any `combat_pair_resolved` without a matching
    // `combat_started` in the same batch would silently disappear from
    // the popup. Surface it.
    const orphanPair = events.find((e) => e.type === "combat_pair_resolved");
    if (orphanPair) {
      _error = "Combat pair event arrived without combat_started — popup skipped.";
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

  const gameSeed = seed || crypto.randomUUID();
  const setupInput = skipSeeding
    ? buildMainSetup(players, DEFAULT_CONFIG, gameSeed)
    : buildSeedingSetup(players);

  const adapters = new Map<string, HotseatAdapter>();
  for (const p of players) {
    const adapter: HotseatAdapter = new HotseatAdapter(onBeforeTurn, onTurnStart, waitForAction);
    if (skipSeeding) adapter.autoSeeding = true;
    adapters.set(p.id, adapter);
  }

  _eventLog = [];
  _error = null;
  _gamePhase = skipSeeding ? "main" : "seeding";
  _prevTurnStartIndex = 0;
  _lastTurnStartIndex = 0;
  _contestResult = null;
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
  _contestResult = null;
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
  if (!resolveAction) {
    // No pending resolver — most likely a double-click or a click after
    // returnToMenu cleared the slots. Surface to the user instead of
    // silently dropping.
    console.warn(
      "selectAction called with no pending resolver — action dropped",
      { actionType: action.type, actionPlayerId: action.playerId },
    );
    _error = "Action dropped — please try again.";
    return;
  }
  const resolve = resolveAction;
  resolveAction = null;
  rejectAction = null;
  resolve($state.snapshot(action));
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
  // Reject pending promises so the game loop terminates cleanly.
  // Any pending pickPrompt on the abandoned state is implicitly discarded:
  // `controller = null` below GCs the entire state, including the prompt.
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
  _contestResult = null;
  _gamePhase = null;
  _currentPlayerName = "";
  _error = null;
  resolveAction = null;
  rejectAction = null;
  resolvePassDevice = null;
  rejectPassDevice = null;
  autoSaveFailCount = 0;
}
