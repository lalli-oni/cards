import {
  createInstanceCounter,
  instantiateCards,
  type Card,
  type CardDefinition,
  type GameConfig,
  type PlayerDescriptor,
  type PolicyCard,
  type SetupInput,
} from "cards-engine";
import cardDefsJson from "@library/all.json";

export const DEFAULT_CONFIG: GameConfig = {
  starting_gold: 10,
  grid_padding: 2,
  action_points_per_turn: 3,
  vp_threshold: 50,
  turn_limit: 20,
  seed_draw: 10,
  seed_keep: 8,
  seed_expose: 2,
  seed_main_deck_draw: 15,
  starting_hand_size: 5,
  max_hand_size: 7,
  raze_ap_cost: 3,
  combat_kill_ratio: 2,
};

export function getCardDefinitions(): CardDefinition[] {
  return cardDefsJson as CardDefinition[];
}

export function buildSeedingSetup(
  players: PlayerDescriptor[],
): SetupInput {
  const defs = getCardDefinitions();
  const counter = createInstanceCounter();
  const nonPolicy = defs.filter((d) => d.type !== "policy");
  const policies = defs.filter((d) => d.type === "policy");

  const decks: Record<
    string,
    { seedingDeck: Card[]; policyPool: PolicyCard[] }
  > = {};
  for (const p of players) {
    decks[p.id] = {
      seedingDeck: instantiateCards(nonPolicy, p.id, counter),
      policyPool: instantiateCards(policies, p.id, counter) as PolicyCard[],
    };
  }
  return { mode: "seeding" as const, decks };
}
