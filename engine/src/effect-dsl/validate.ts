import type { Expression, Effect } from "./types";

export class DSLValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DSLValidationError";
  }
}

// `pick` pauses the executor for player input (see #101). Until #103 lands,
// the executor can't resume the rest of a chain after the pause, so any chain
// containing `pick` must end with it.
export function validateEffectChain(ast: Expression): void {
  ast.forEach((effect: Effect, effectIdx: number) => {
    effect.forEach((step, stepIdx) => {
      if (step.primitive.verb !== "pick") return;
      if (stepIdx !== effect.length - 1) {
        throw new DSLValidationError(
          `'pick' must be the terminal step of an effect chain ` +
            `(chain #${effectIdx}: pick at step ${stepIdx} of ${effect.length - 1})`,
        );
      }
    });
  });
}
