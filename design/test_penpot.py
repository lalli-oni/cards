#!/usr/bin/env python3
"""Standalone tests for penpot.py's text-fit primitive (#10 overflow handling).

The renderer is Python while the rest of the suite is bun/TS, so these run
standalone:  python3 design/test_penpot.py  (exit 0 = pass).

Covers fit_text's shrink-before-truncate strategy, the height/max_lines budget,
the min-font-size floor, and the ellipsis trimming — the branches that decide
whether gameplay text is preserved, shrunk, or dropped.
"""

import importlib.util
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

_spec = importlib.util.spec_from_file_location(
    "penpot", os.path.join(SCRIPT_DIR, "penpot.py"))
pp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pp)

_failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        _failures.append(name)


# A width that fits ~30 chars at 14px (30 * 14 * 0.56 ≈ 235).
W = 236
SHORT = "Deal 3 damage."
# ~15 wrapped lines at 14px in a W-wide box.
LONG = " ".join(["Deal three damage to a chosen enemy unit"] * 12)


def _height_for(lines, fs, line_height=1.3):
    """Min box height that admits exactly `lines` at `fs` under FIT_SAFETY."""
    return (lines * fs * line_height) / pp.FIT_SAFETY + 0.001


def test_no_overflow_keeps_base():
    print("fit_text: text that already fits:")
    r = pp.fit_text(SHORT, W, _height_for(1, 14), base_fs=14)
    check("short text → keeps base font size", r["font_size"] == "14")
    check("short text → not truncated", r["truncated"] is False)
    check("short text → single line preserved", r["lines"] == [SHORT])
    check("short text → text == joined lines", r["text"] == "Deal 3 damage.")


def test_empty_text():
    print("fit_text: empty text:")
    r = pp.fit_text("", W, 100, base_fs=14)
    check("empty → no lines", r["lines"] == [])
    check("empty → empty text", r["text"] == "")
    check("empty → not truncated", r["truncated"] is False)
    check("empty → keeps base size", r["font_size"] == "14")


def test_shrinks_before_truncating():
    print("fit_text: shrink to fit (no loss):")
    # A budget too small for 14px but reachable by shrinking: give it the height
    # LONG needs at 10px, and confirm it lands >= floor without truncating.
    lines_at_10 = len(pp._wrap_lines(LONG, W, 10, pp.CHAR_ADVANCE))
    h = _height_for(lines_at_10, 10)
    r = pp.fit_text(LONG, W, h, base_fs=14, min_fs=10)
    check("long text in a shrink-reachable box → not truncated", r["truncated"] is False)
    check("long text → font reduced below base", float(r["font_size"]) < 14)
    check("long text → font at or above floor", float(r["font_size"]) >= 10)
    check("long text → all words preserved (no ellipsis)", pp.ELLIPSIS not in r["text"])


def test_truncates_at_floor():
    print("fit_text: truncate when even the floor overflows:")
    # Only room for ~2 lines even at the 10px floor → must truncate + ellipsis.
    r = pp.fit_text(LONG, W, _height_for(2, 10), base_fs=14, min_fs=10)
    check("tiny box → truncated", r["truncated"] is True)
    check("tiny box → clamped at the floor size", r["font_size"] == "10")
    check("tiny box → line count within budget", len(r["lines"]) <= 2)
    check("tiny box → last line ends with ellipsis", r["lines"][-1].endswith(pp.ELLIPSIS))


def test_truncated_line_fits_width():
    print("fit_text: truncated line respects width:")
    r = pp.fit_text(LONG, W, _height_for(1, 10), base_fs=14, min_fs=10)
    last = r["lines"][-1]
    width = len(last) * 10 * pp.CHAR_ADVANCE
    check("truncated → single line", len(r["lines"]) == 1)
    check("truncated → ellipsised line still fits the box width", width <= W)


def test_max_lines_cap():
    print("fit_text: max_lines cap without a height limit:")
    r = pp.fit_text(LONG, W, None, base_fs=14, min_fs=10, max_lines=2)
    check("max_lines → at most 2 lines", len(r["lines"]) <= 2)
    check("max_lines exceeded → truncated", r["truncated"] is True)
    check("max_lines → ellipsis on last line", r["lines"][-1].endswith(pp.ELLIPSIS))
    # A short text under the cap keeps base size and is untouched.
    r2 = pp.fit_text(SHORT, W, None, base_fs=14, max_lines=2)
    check("under the cap → base size, no truncation",
          r2["font_size"] == "14" and r2["truncated"] is False)


def test_position_data_reflows_to_fit():
    print("fit_text → make_position_data agree on line count:")
    # The display string must re-wrap (in make_position_data) to the same number
    # of lines at the chosen size, so content and position-data stay consistent.
    r = pp.fit_text(LONG, W, _height_for(6, 12), base_fs=14, min_fs=10)
    entries = pp.make_position_data(r["text"], 0, 0, W, 500, font_size=r["font_size"])
    check("position-data line count matches fitted lines", len(entries) == len(r["lines"]))
    check("no rendered line exceeds the box width",
          all(e["width"] <= W + 0.5 for e in entries))


def test_half_step_sizes_format():
    print("fit_text: half-step sizes format cleanly:")
    check("_fmt_fs whole → int string", pp._fmt_fs(12.0) == "12")
    check("_fmt_fs half → one decimal", pp._fmt_fs(10.5) == "10.5")


if __name__ == "__main__":
    test_no_overflow_keeps_base()
    test_empty_text()
    test_shrinks_before_truncating()
    test_truncates_at_floor()
    test_truncated_line_fits_width()
    test_max_lines_cap()
    test_position_data_reflows_to_fit()
    test_half_step_sizes_format()
    if _failures:
        print(f"\n{len(_failures)} FAILED: {', '.join(_failures)}")
        sys.exit(1)
    print("\nAll penpot fit_text tests passed.")
