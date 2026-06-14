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
//     - For `peek(deck)`: count >= 1 (zero or negative makes no sense; the
//       executor stores [] which then no-ops on pick).
//     - For `peek(opponent + hand)`: count must NOT be supplied — the whole
//       hand is revealed. Must be the terminal step of the last effect chain
//       (suspends execution via `viewPrompt`; anything after it would be
//       silently dropped when execution resumes after `dismiss_view`).
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
        const tokens = step.primitive.target?.tokens.map((t) => t.name) ?? [];
        const isOpponentHand = tokens.includes("opponent") && tokens.includes("hand");
        if (isOpponentHand) {
          if (step.primitive.value !== undefined) {
            throw new DSLValidationError(
              `'peek(opponent + hand)' does not accept a count (got [${step.primitive.value}]) — the full hand is revealed`,
            );
          }
          const isLastStep = stepIdx === effect.length - 1;
          const isLastEffect = effectIdx === ast.length - 1;
          if (!isLastStep || !isLastEffect) {
            throw new DSLValidationError(
              `'peek(opponent + hand)' must be the terminal primitive of the last effect chain in an expression ` +
                `(chain #${effectIdx} of ${ast.length - 1}, step ${stepIdx} of ${effect.length - 1})`,
            );
          }
        } else {
          const value = step.primitive.value ?? 0;
          if (value < 1) {
            throw new DSLValidationError(
              `'peek' requires a positive count (got ${value})`,
            );
          }
        }
      }
      if (step.primitive.verb === "contest") {
        // `contest.<stat>` does NOT accept a `[N]` bonus literal. The old
        // surfacing patched it in as a synthetic modifier sourced from the
        // acting card, which bypassed the listener pipeline's source
        // attribution. Use a `buff.<stat>(self)[N]~turn + contest.<stat>(...)`
        // chain instead so the +N appears in the contest's per-side
        // modifier breakdown alongside listener-sourced buffs.
        if (step.primitive.value !== undefined) {
          throw new DSLValidationError(
            `'contest.${step.primitive.subVerb ?? "?"}' does not accept a [N] bonus (got [${step.primitive.value}]) — use 'buff.<stat>(self)[N]~turn + contest.<stat>(...)' instead`,
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
