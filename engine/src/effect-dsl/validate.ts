import type { Expression, Effect } from "./types";

export class DSLValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DSLValidationError";
  }
}

// Static rules for `peek` and `pick`:
//
//   peek:
//     - count >= 1 (zero or negative makes no sense; the executor stores []
//       which then no-ops on pick).
//
//   pick:
//     - count >= 1 (default 1 if omitted).
//     - Must be preceded by a producer (`peek`) in the same chain. Without
//       one, `_peekedCards` is undefined and the executor would silently
//       no-op.
//     - Must be the terminal step of the LAST effect chain in the expression.
//       Anything after it (later steps in the same chain, or later chains
//       joined by `+`) would be silently dropped, because the suspend check
//       bubbles out of both executor loops.
//
// Delete the terminal-pick rule once #103 lands (chain resumption past pick).
export function validateEffectChain(ast: Expression): void {
  ast.forEach((effect: Effect, effectIdx: number) => {
    let sawProducer = false;
    effect.forEach((step, stepIdx) => {
      if (step.primitive.verb === "peek") {
        sawProducer = true;
        const value = step.primitive.value ?? 0;
        if (value < 1) {
          throw new DSLValidationError(
            `'peek' requires a positive count (got ${value})`,
          );
        }
      }
      if (step.primitive.verb !== "pick") return;

      const pickCount = step.primitive.value ?? 1;
      if (pickCount < 1) {
        throw new DSLValidationError(
          `'pick' requires a positive count (got ${pickCount})`,
        );
      }
      if (!sawProducer) {
        throw new DSLValidationError(
          `'pick' requires a preceding producer (e.g. 'peek') in the same chain ` +
            `(chain #${effectIdx}, step ${stepIdx})`,
        );
      }
      const isLastStep = stepIdx === effect.length - 1;
      const isLastEffect = effectIdx === ast.length - 1;
      if (!isLastStep || !isLastEffect) {
        throw new DSLValidationError(
          `'pick' must be the terminal primitive of the last effect chain in an expression ` +
            `(chain #${effectIdx} of ${ast.length - 1}, step ${stepIdx} of ${effect.length - 1})`,
        );
      }
    });
  });
}
