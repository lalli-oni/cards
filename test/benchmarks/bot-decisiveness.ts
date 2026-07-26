#!/usr/bin/env bun
/**
 * Bot-decisiveness benchmark (#247).
 *
 * Measures how often greedy-bot games reach a decision by the turn limit vs.
 * tie into overtime or never terminate — a quantitative read on bot progress.
 * A game that ties on VP at the turn limit enters overtime ("play until a sole
 * leader"); if the bots gain no asymmetric VP it never terminates. Better bots
 * should drive the tie / stalemate rates toward zero.
 *
 * Usage:
 *   bun test/benchmarks/bot-decisiveness.ts [players=2] [seeds=1000]
 *
 * Metric of record is 2 players (see #247). Not a *.test.ts — it is a
 * standalone harness, not run by `bun test`.
 */
import {
  GameController,
  BotAdapter,
  loadCardDefinitionsFromBuild,
  createInstanceCounter,
  instantiateCards,
} from "cards-engine";
import { join } from "path";

const PLAYERS = Number(process.argv[2] ?? 2);
const SEEDS = Number(process.argv[3] ?? 1000);
// Beyond ~round 100 for 2 players — a game unresolved by here is a persistent
// stalemate (a tied game that resolves in overtime does so in a few rounds).
const ACTION_CAP = 800;

const BUILD_DIR = join(import.meta.dir, "../../library/build");
const CONFIG = {
  starting_gold: 10, grid_padding: 2, action_points_per_turn: 3,
  vp_threshold: 50, turn_limit: 20, seed_draw: 10, seed_keep: 8,
  seed_expose: 2, seed_main_deck_draw: 15, starting_hand_size: 5,
  max_hand_size: 7, raze_ap_cost: 3, combat_kill_ratio: 2,
};

const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
const nonPolicy = defs.filter((d: any) => d.type !== "policy");
const policies = defs.filter((d: any) => d.type === "policy");

function players() {
  return Array.from({ length: PLAYERS }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
}
function setupInput(ps: any[]) {
  const counter = createInstanceCounter();
  const decks: any = {};
  for (const p of ps) decks[p.id] = {
    seedingDeck: instantiateCards(nonPolicy, p.id, counter),
    policyPool: instantiateCards(policies, p.id, counter),
  };
  return { mode: "seeding" as const, decks };
}

/** Ending round for one game, or -1 for a persistent stalemate. */
async function endRound(seed: string): Promise<number> {
  const ps = players();
  const c = new GameController({
    config: CONFIG, players: ps, seed, setupInput: setupInput(ps),
    adapters: new Map(ps.map((p, i) => [p.id, new BotAdapter(i + 1, "greedy")])),
  });
  try {
    await c.run(ACTION_CAP);
    return (c.getState() as any).turn.round;
  } catch {
    return -1;
  }
}

const rounds: number[] = [];
for (let i = 0; i < SEEDS; i++) rounds.push(await endRound(`seed-${i}`));

const limit = CONFIG.turn_limit;
const pct = (n: number) => ((n / SEEDS) * 100).toFixed(1) + "%";
const count = (f: (r: number) => boolean) => rounds.filter(f).length;

// Decided-by-limit = resolved at/before the first post-limit check (round <= limit+1).
// Tied@limit = needed real overtime (round > limit+1) or never resolved (-1).
const thresholdWin = count((r) => r >= 0 && r <= limit);
const decidedAtLimit = count((r) => r === limit + 1);
const tiedResolved = count((r) => r > limit + 1);
const stalemate = count((r) => r === -1);

console.log(`Bot-decisiveness benchmark — ${PLAYERS} players, ${SEEDS} seeds (greedy bots)\n`);
console.log(`  won by VP threshold (<= round ${limit})   ${pct(thresholdWin)}`);
console.log(`  decided at the limit (round ${limit + 1})     ${pct(decidedAtLimit)}`);
console.log(`  tied at limit, resolved in overtime     ${pct(tiedResolved)}`);
console.log(`  never terminates (stalemate)            ${pct(stalemate)}`);
console.log(`\n  tied at limit (overtime + stalemate)    ${pct(tiedResolved + stalemate)}`);
console.log(`  never terminates                        ${pct(stalemate)}`);
