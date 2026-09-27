import { describe, expect, it } from "bun:test";
import { formatRewards } from "../formatRequirements";

// Mission rewards are effect-DSL expressions (library/build.ts restricts them
// to gold / vp / draw). GridCell and CardView show them through formatRewards.
describe("formatRewards", () => {
  it("shows a VP-only reward as stars, the shape every alpha-1 mission had before gold rewards", () => {
    expect(formatRewards("vp[5]")).toBe("5 ⭐");
  });

  it("formats each part of a compound common-tier reward like gold[2] + vp[1]", () => {
    expect(formatRewards("gold[2] + vp[1]")).toBe("2g + 1 ⭐");
  });

  it("keeps a chain's '>' so the order of steps stays visible", () => {
    expect(formatRewards("draw[1] > gold[1]")).toBe("1 card(s) > 1g");
  });

  it("leaves an unrecognised expression verbatim rather than hiding it", () => {
    // Guards the pre-DSL display bug: `"vp[5]".replace("vp", " ⭐")` rendered
    // " ⭐[5]". Anything the formatter doesn't know should read as authored.
    expect(formatRewards("buff(self)[1]")).toBe("buff(self)[1]");
  });
});
