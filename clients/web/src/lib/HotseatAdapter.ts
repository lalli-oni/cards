import {
  fillAction,
  type Action,
  type PlayerAdapter,
  type VisibleState,
} from "cards-engine";

export class HotseatAdapter implements PlayerAdapter {
  autoSeeding: boolean = false;

  constructor(
    private onBeforeTurn: (playerId: string) => Promise<void>,
    private onTurnStart: (
      visibleState: VisibleState,
      validActions: Action[],
    ) => void,
    private waitForAction: () => Promise<Action>,
  ) {}

  async chooseAction(
    visibleState: VisibleState,
    validActions: Action[],
  ): Promise<Action> {
    // Skip seeding: auto-submit all seeding actions with random/default choices
    if (this.autoSeeding && visibleState.phase === "seeding") {
      return fillAction(visibleState, validActions[0]);
    }

    // seed_draw requires no player interaction — auto-submit immediately
    if (
      visibleState.seedingStep === "seed_draw" &&
      validActions.length === 1 &&
      validActions[0].type === "seed_draw"
    ) {
      return validActions[0];
    }

    // During steals, the middle area is exposed to all — no device pass needed
    if (visibleState.seedingStep === "seed_steal") {
      this.onTurnStart(visibleState, validActions);
      return this.waitForAction();
    }

    await this.onBeforeTurn(visibleState.currentPlayerId);
    this.onTurnStart(visibleState, validActions);
    return this.waitForAction();
  }
}
