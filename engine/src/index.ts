// Core API
export { createGame } from "./create-game";
export { applyAction } from "./apply-action";
export type { ApplyResult } from "./apply-action";
export { getValidActions } from "./valid-actions";
export { getVisibleState } from "./visible-state";

// Controller
export { GameController } from "./controller";
export type { ControllerOptions } from "./controller";

// Rules config
export { buildBaselineConfig, extractVars, parseVarValue, mergeVariant } from "./rules-config";

// Adapters
export { BotAdapter } from "./bot-adapter";

// Types
export type {
  GameConfig,
  PlayerDescriptor,
  PlayerState,
  CardType,
  Rarity,
  EventSubtype,
  LocationEdges,
  Card,
  UnitCard,
  LocationCard,
  ItemCard,
  EventCard,
  PolicyCard,
  GridCell,
  Trap,
  TrapView,
  Grid,
  Phase,
  DeckName,
  TurnState,
  GameState,
  Action,
  GameEvent,
  VisibleState,
  OpponentView,
  Session,
  PlayerAdapter,
} from "./types";
