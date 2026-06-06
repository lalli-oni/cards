import { describe, expect, it } from "bun:test";
import { VERBS, isHqSafeVerb, type Verb } from "../effect-dsl";

// Adding a verb to VERBS without an entry here fails the suite — forces an
// explicit HQ-safety classification on every new verb.
const EXPECTED: Record<Verb, boolean> = {
  gold: true,
  vp: true,
  draw: true,
  peek: true,
  pick: true,
  buy: true,
  reveal: true,
  kill: false,
  injure: false,
  buff: false,
  move: false,
  control: false,
  remove: false,
  raze: false,
  to: false,
  contest: false,
};

describe("isHqSafeVerb", () => {
  for (const verb of VERBS) {
    it(`classifies ${verb} as ${EXPECTED[verb] ? "HQ-safe" : "grid-only"}`, () => {
      expect(isHqSafeVerb(verb)).toBe(EXPECTED[verb]);
    });
  }

  it("rejects unknown verbs conservatively", () => {
    expect(isHqSafeVerb("not-a-verb")).toBe(false);
    expect(isHqSafeVerb("")).toBe(false);
  });
});
