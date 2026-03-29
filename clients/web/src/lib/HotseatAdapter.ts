import type {
  Action,
  PlayerAdapter,
  VisibleState,
} from "cards-engine";

export class HotseatAdapter implements PlayerAdapter {
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
    await this.onBeforeTurn(visibleState.currentPlayerId);
    this.onTurnStart(visibleState, validActions);
    return this.waitForAction();
  }
}
