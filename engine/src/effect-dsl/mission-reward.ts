import { parse, DSLParseError } from "./parser";
import { DSLValidationError } from "./validate";
import type { Primitive, Step } from "./types";

/** Verbs a mission reward may use. Completion runs the reward with no target
 *  and carries on discarding afterwards, so a verb that needs a target or
 *  suspends for a prompt (`peek`/`pick`) would no-op or strand the completion. */
export const MISSION_REWARD_VERBS: ReadonlySet<string> = new Set(["gold", "vp", "draw"]);

/**
 * Problems with a mission reward expression; empty when it's safe to run.
 *
 * Shared by `library/build.ts` and the engine's card loader so a stale or
 * hand-edited library can't reach `handleAttemptMission` with a reward the
 * build would have rejected. Beyond the verb allowlist, a step must be a bare
 * `verb[N]`: the gold/vp/draw executors ignore selectors (so `vp(opponent)[3]`
 * would pay the completer), a `:` consequence only ever runs after a `contest`
 * (so it would be dropped), and a missing value defaults to 0.
 */
export function missionRewardErrors(expr: string): string[] {
  let steps: Step[];
  try {
    steps = parse(expr).flat();
  } catch (e) {
    const msg: string = e instanceof DSLParseError || e instanceof DSLValidationError ? e.message : String(e);
    return [`invalid DSL in mission reward: ${msg}`];
  }

  const errors: string[] = [];
  const allowed: string = [...MISSION_REWARD_VERBS].join(", ");
  for (const step of steps) {
    const p: Primitive = step.primitive;
    if (!MISSION_REWARD_VERBS.has(p.verb)) {
      errors.push(`mission reward uses ${p.verb} — only ${allowed} are allowed`);
      continue;
    }
    if (p.target || p.subVerb || p.modifiers.length > 0) {
      errors.push(`mission reward step ${p.verb} must be a bare ${p.verb}[N] — rewards always go to the completing player`);
    }
    if (step.consequence) {
      errors.push(`mission reward step ${p.verb} has a ':' branch, which only runs after a contest`);
    }
    if (p.value === undefined || p.value < 1) {
      errors.push(`mission reward step ${p.verb} needs a positive amount, e.g. ${p.verb}[1]`);
    }
  }
  return errors;
}
