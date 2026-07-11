import { describe, expect, it } from "bun:test";
import {
  appendBanner,
  shouldReenableAfterRejection,
} from "../promptRecovery";

describe("appendBanner", () => {
  it("returns the message when the banner is empty", () => {
    expect(appendBanner(null, "oops")).toBe("oops");
    expect(appendBanner("", "oops")).toBe("oops");
  });

  it("newline-separates a distinct new message", () => {
    expect(appendBanner("first", "second")).toBe("first\nsecond");
  });

  it("dedupes a consecutive identical trailing message", () => {
    // The rejection re-prompt pushes the same line each time — it must not stack.
    const msg = "That move wasn't legal — please choose again (Ada).";
    let banner = appendBanner(null, msg);
    for (let i = 0; i < 100; i++) banner = appendBanner(banner, msg);
    expect(banner).toBe(msg); // one line, not 101
  });

  it("still accumulates a distinct message after a repeated one", () => {
    const reject = "That move wasn't legal — please choose again (Ada).";
    let banner = appendBanner(null, reject);
    banner = appendBanner(banner, reject); // deduped
    banner = appendBanner(banner, "Auto-save is failing.");
    expect(banner).toBe(`${reject}\nAuto-save is failing.`);
  });

  it("only compares the trailing segment, not earlier lines", () => {
    // A message equal to an EARLIER (non-trailing) line is still appended.
    const banner = appendBanner("a\nb", "a");
    expect(banner).toBe("a\nb\na");
  });
});

describe("shouldReenableAfterRejection", () => {
  it("stays locked when not mid-submit", () => {
    expect(shouldReenableAfterRejection(false, 5, 3)).toBe(false);
  });

  it("stays locked while the nonce is unchanged since submit", () => {
    expect(shouldReenableAfterRejection(true, 3, 3)).toBe(false);
  });

  it("unlocks when the nonce advances past the submit-time value", () => {
    expect(shouldReenableAfterRejection(true, 4, 3)).toBe(true);
  });

  it("unlocks on any nonce change (a second rejection re-arms too)", () => {
    // Two consecutive rejections yield identical banner text (deduped), but the
    // nonce still advances — so the overlay unlocks each time, which the old
    // error-string approach could not guarantee.
    expect(shouldReenableAfterRejection(true, 5, 4)).toBe(true);
  });
});
