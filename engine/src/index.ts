// Core API

export type { ApplyResult } from "./apply-action";
export { applyAction } from "./apply-action";
// Adapters
export { BotAdapter } from "./bot-adapter";
export type { CardDefinition, InstanceCounter } from "./card-loader";
// Card loader
export {
  CardValidationError,
  createInstanceCounter,
  instantiateCard,
  instantiateCards,
  loadCardDefinitions,
  loadCardDefinitionsFromBuild,
} from "./card-loader";
export type { ControllerOptions } from "./controller";
// Controller
export { GameController } from "./controller";
export { createGame } from "./create-game";
// Rules config
export {
  buildBaselineConfig,
  extractVars,
  mergeVariant,
  parseVarValue,
} from "./rules-config";
// Types
export type {
  Action,
  ActionForState,
  Card,
  CardType,
  DeckName,
  EndedGameState,
  ActivePassiveEvent,
  EventCard,
  EventSubtype,
  InstantEventCard,
  GameConfig,
  GameEvent,
  GameState,
  Grid,
  GridCell,
  ItemCard,
  LocationCard,
  LocationEdges,
  MainAction,
  MainGameState,
  OpponentView,
  Phase,
  PlayerAdapter,
  PlayerDescriptor,
  PlayerState,
  PassiveEventCard,
  PolicyCard,
  Rarity,
  SeedingGameState,
  Session,
  Trap,
  TrapEventCard,
  TrapView,
  TurnState,
  UnitCard,
  VisibleState,
} from "./types";
export { getActivePlayerId } from "./types";
export { getValidActions } from "./valid-actions";
export { getVisibleState } from "./visible-state";
// Win condition
export { findSoleLeader, getScores, shouldEndGame, toEndedState } from "./win-condition";
