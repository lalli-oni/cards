// Core API
export { createGame } from "./create-game";
export { applyAction } from "./apply-action";
export type { ApplyResult } from "./apply-action";
export { getValidActions } from "./valid-actions";
export { getVisibleState } from "./visible-state";

// Controller
export { GameController } from "./controller";
export type { ControllerOptions } from "./controller";

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
  GridCell,
  Trap,
  Grid,
  Phase,
  TurnState,
  GameState,
  Action,
  GameEvent,
  VisibleState,
  OpponentView,
  Session,
  PlayerAdapter,
} from "./types";
