#!/usr/bin/env python3
"""Standalone tests for the print tooling's pure logic (#250).

Like the other design/ tests these run standalone:
  python3 design/test_print_tools.py   (exit 0 = pass)

Covers the rules->A4 markdown transforms (the parts most likely to silently
mangle rules text) and the imposition grid packing. The scripts have hyphenated
filenames, so they are loaded via importlib rather than imported by name.
"""

import importlib.util
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _load(mod_name, filename):
    spec = importlib.util.spec_from_file_location(mod_name, os.path.join(SCRIPT_DIR, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r2a = _load("rules_to_a4", "rules-to-a4.py")
imp = _load("impose_print", "impose-print.py")

_failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        _failures.append(name)


def test_strip_design_balanced():
    print("strip_design removes [design:] blocks, including nested [var:]:")
    # A design block nests a [var:...] token; naive [^]]* matching would stop at
    # the inner ']' and leak "], they draw..." into the output. Balanced scan must
    # consume the whole block.
    src = "Keep me. [design: note with [var:seed_draw:10] inside] Keep this too."
    out = r2a.strip_design(src)
    check("whole nested block gone", "design" not in out and "seed_draw" not in out)
    check("surrounding prose intact", "Keep me." in out and "Keep this too." in out)
    # A design block that was its own bullet must not leave a dangling "- ".
    bullet = "- Real item\n- [design: internal only]\n- Another item"
    out2 = r2a.strip_design(bullet)
    check("empty bullet line removed", "\n- \n" not in out2 and out2.count("- ") == 2)


def test_var_substitution():
    print("transform substitutes [var:id:value] as a colour-coded chip:")
    out = r2a.transform("Reach [var:vp_threshold:50] VP.")
    check("baseline value shown", ">50<" in out)
    check("wrapped in .var chip", 'class="var"' in out and "vp_threshold" in out)
    check("token markup gone", "[var:" not in out)
    # Two-part section markers carry no value and must simply disappear.
    check("section marker dropped",
          "[var:seeding-phase]" not in r2a.transform("### Seeding Phase [var:seeding-phase]"))


def test_blank_before_lists():
    print("blank_before_lists opens a list that abuts a paragraph line:")
    # "intro:" directly precedes a bullet with no blank line — markdown would fold
    # the bullets into the paragraph without this fix-up.
    fixed = r2a.blank_before_lists("Starts with:\n- one\n- two")
    check("blank inserted after prose", fixed.startswith("Starts with:\n\n- one"))
    # A genuine nested list under an ordered item must NOT gain a blank line
    # (that would break the nesting into a sibling list).
    nested = "1. Draw:\n  - sub a\n  - sub b"
    check("nested list untouched", r2a.blank_before_lists(nested) == nested)


def test_badge_inline_stats():
    print("badge_inline_stats badges AP/VP in text but not inside tags:")
    out = r2a.badge_inline_stats('<a href="/ap">costs 2 AP</a> and 1 VP')
    check("AP in text badged", '<span class="ico ap">AP</span>' in out)
    check("VP in text badged", '<span class="ico vp">VP</span>' in out)
    check("href attribute untouched", 'href="/ap"' in out)


def test_toc_html():
    print("toc_html renders indented rows with (or without) page numbers:")
    rows = r2a.toc_html([(1, "Master Design Document", 3), (2, "Core Architecture", None)])
    check("level-1 row + page number", 'class="toc-row l1"' in rows and ">3<" in rows)
    check("level-2 row", 'class="toc-row l2"' in rows)
    # A None page (pass 1 / no-pymupdf fallback) renders an empty number, not "None".
    check("None page -> blank, not 'None'", "None" not in rows and '<span class="pg"></span>' in rows)


def test_row_packing():
    print("row packing mixes same-width sizes onto shared sheets to save paper:")
    # A3 @300 DPI; alpha-1 = 50 poker (750x1050) + 16 square location (750x750)
    # cards, all the same width. The naive size-siloed layout was 4 poker pages
    # (last holding only 2) + 1 half-empty locations page = 5 sheets. Packing rows
    # of both heights together must fit in 4.
    mm = 300 / 25.4
    pw, ph = round(297 * mm), round(420 * mm)
    gutter, budget = round(4 * mm), round(420 * mm) - 2 * round(8 * mm)
    groups = {(750, 1050): [f"p{i}" for i in range(50)],
              (750, 750): [f"s{i}" for i in range(16)]}
    rows = imp.make_rows(groups, pw, gutter)
    check("50 poker -> 13 rows + 16 square -> 4 rows", len(rows) == 17)
    pages = imp.paginate(rows, budget, gutter)
    check("packs into 4 sheets, not 5", len(pages) == 4)
    # The leftover poker row shares its sheet with square rows — the whole point.
    last_heights = {r["h"] for r in pages[-1]}
    check("last sheet mixes 1050 + 750 rows", last_heights == {1050, 750})
    used = lambda pg: sum(r["h"] for r in pg) + gutter * (len(pg) - 1)
    check("no sheet exceeds the vertical budget", all(used(pg) <= budget for pg in pages))


if __name__ == "__main__":
    test_strip_design_balanced()
    test_var_substitution()
    test_blank_before_lists()
    test_badge_inline_stats()
    test_toc_html()
    test_row_packing()
    if _failures:
        print(f"\n{len(_failures)} FAILED: {', '.join(_failures)}")
        sys.exit(1)
    print("\nAll print-tooling tests passed.")
