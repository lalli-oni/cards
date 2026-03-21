import prand from "pure-rand";
import type { PlayerAdapter, VisibleState, Action } from "./types";

/**
 * Bot player adapter. Picks actions using heuristics and a seeded RNG.
 * Strategy logic is out of scope for the initial scaffold — this stub
 * picks a random valid action.
 */
export class BotAdapter implements PlayerAdapter {
  private rng: prand.RandomGenerator;

  constructor(seed: number) {
    this.rng = prand.mersenne(seed);
  }

  async chooseAction(
    _visibleState: VisibleState,
    validActions: Action[],
  ): Promise<Action> {
    if (validActions.length === 0) {
      throw new Error("BotAdapter: no valid actions available");
    }

    // Stub: pick a random action
    const [index, nextRng] = prand.uniformIntDistribution(
      0,
      validActions.length - 1,
      this.rng,
    );
    this.rng = nextRng;

    return validActions[index];
  }
}
