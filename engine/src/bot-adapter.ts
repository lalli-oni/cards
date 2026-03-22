import prand from "pure-rand";
import { fillAction } from "./action-helpers";
import type { Action, PlayerAdapter, VisibleState } from "./types";

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
    visibleState: VisibleState,
    validActions: Action[],
  ): Promise<Action> {
    if (validActions.length === 0) {
      throw new Error("BotAdapter: no valid actions available");
    }

    // Pick a random action and fill in template fields
    const [index, nextRng] = prand.uniformIntDistribution(
      0,
      validActions.length - 1,
      this.rng,
    );
    this.rng = nextRng;

    return fillAction(visibleState, validActions[index]);
  }
}
