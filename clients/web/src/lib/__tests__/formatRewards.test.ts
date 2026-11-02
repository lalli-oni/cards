import { describe, expect, it } from "bun:test";
import { formatRewards } from "../formatRequirements";

// Mission rewards are effect-DSL expressions (library/build.ts restricts them
// to gold / vp / draw). GridCell and CardView show them through formatRewards.
describe("formatRewards", () => {
  it("shows a VP-only reward as stars, the shape most missions use", () => {
    // Guards the display regression this formatter replaced: GridCell used
    // `rewards.replace("vp", " ⭐")`, written for the old `5vp` shape, which on
    // `vp[5]` renders " ⭐[5]".
    expect(formatRewards("vp[5]")).toBe("5 ⭐");
  });

  it("formats each part of a compound common-tier reward like gold[2] + vp[1]", () => {
    expect(formatRewards("gold[2] + vp[1]")).toBe("2g + 1 ⭐");
  });

  it("keeps a chain's '>' so the order of steps stays visible", () => {
    expect(formatRewards("draw[1] > gold[1]")).toBe("1 card(s) > 1g");
  });

  it("leaves an unrecognised expression verbatim rather than hiding it", () => {
    // The build rejects any reward step that isn't a bare gold/vp/draw[N], so
    // this only matters for a stale or hand-edited library. Showing the text as
    // authored beats dropping it, so an unexpected reward is still visible.
    expect(formatRewards("buff(self)[1]")).toBe("buff(self)[1]");
  });

  it("leaves a targeted verb verbatim, since `verb[N]` must be adjacent", () => {
    // `gold(opponent)[3]` is rejected by the build (rewards always pay the
    // completer). The regex only matches `[` directly after the verb, so it
    // isn't half-rewritten into "gold(opponent)3g".
    expect(formatRewards("gold(opponent)[3]")).toBe("gold(opponent)[3]");
  });
});
