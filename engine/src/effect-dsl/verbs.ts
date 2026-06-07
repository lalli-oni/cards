/**
 * Central registry of DSL verbs with metadata. Mirrors the dispatch in
 * `executor.ts` — adding a verb there means adding it here too.
 */

export const VERBS = [
  "gold",
  "vp",
  "draw",
  "peek",
  "pick",
  "buy",
  "kill",
  "injure",
  "buff",
  "move",
  "control",
  "remove",
  "raze",
  "to",
  "contest",
] as const;

export type Verb = (typeof VERBS)[number];

// Verbs whose effect depends only on player state — safe to execute from HQ
// where the acting unit has no grid coordinates.
const HQ_SAFE: ReadonlySet<Verb> = new Set([
  "gold",
  "vp",
  "draw",
  "peek",
  "pick",
  "buy",
]);

/** True if the verb operates purely on player state (no grid context needed). */
export function isHqSafeVerb(verb: string): boolean {
  return HQ_SAFE.has(verb as Verb);
}
