// Core API

export { fillAction } from "./action-helpers";
export type { ApplyResult } from "./apply-action";
export { applyAction } from "./apply-action";
// Adapters
export { BotAdapter } from "./bot-adapter";
export type { BotStrategy } from "./bot-adapter";
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
export { deriveCombatOutcome } from "./apply-main";
// Pre-built game setup
export type { PrebuiltGameInput, PrebuiltPlayerInput } from "./prebuilt";
export { buildPrebuiltSetup } from "./prebuilt";
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
  ActionDef,
  ActionForState,
  Card,
  CardType,
  CombatPairOutcome,
  CombatSide,
  ContestSide,
  SetupInput,
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
  ModifierEntry,
  ModifierSource,
  ModifierSourceType,
  OpponentView,
  Phase,
  PlayerAdapter,
  PlayerDescriptor,
  PlayerState,
  PassiveEventCard,
  PickPrompt,
  PolicyCard,
  Rarity,
  ResolutionSide,
  Reveals,
  SeedingGameState,
  Session,
  StatModifier,
  StatName,
  Trap,
  TrapEventCard,
  TrapView,
  TurnState,
  UnitCard,
  VisibleState,
} from "./types";
export { getActivePlayerId } from "./types";
export { getValidActions } from "./valid-actions";
export { getVisibleState, getVisibleEvent, getVisibleEvents } from "./visible-state";
// Listeners
export type { EffectListener, EffectSource, EmitFn, RevealsProvider } from "./listeners";
export { emit, rebuildListeners } from "./listeners";
export {
  LOCATION_EFFECTS,
  POLICY_EFFECTS,
  PASSIVE_EVENT_EFFECTS,
  TRAP_EFFECTS,
  ITEM_EFFECTS,
  UNIT_EFFECTS,
  POLICY_ACTIONS,
} from "./listeners";
// Win condition
export { findSoleLeader, getScores, shouldEndGame, toEndedState } from "./win-condition";
// Immer re-export — clients may need to disable auto-freeze for reactive frameworks
export { setAutoFreeze } from "immer";
// RNG — wrapper around pure-rand v8 exposing the engine's serializable
// immutable-style API. All consumers should use these, not import
// pure-rand directly. See engine/src/rng.ts for the boundary rationale.
export {
  mersenne,
  fromState,
  uniformIntDistribution,
  shuffle,
  extractRngState,
} from "./rng";
export type { RandomGenerator } from "./rng";
