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


def test_layout_packing():
    print("impose.layout packs true-size cells with margins on the page:")
    # A3 @300 DPI = 3508x4961; poker cards 750x1050 pack 4x4 = 16 per sheet, so
    # 50 cards -> 4 pages. Pins the shop-floor expectation from the issue.
    a3 = (3508, 4961)
    gutter = round(4 * 300 / 25.4)
    files = [os.path.join(SCRIPT_DIR, "penpot.py")] * 50  # any readable path; not opened here
    pages = list(_dry_layout(imp, files, 750, 1050, a3, gutter))
    check("50 poker cards -> 4 A3 pages", len(pages) == 4)
    square = [os.path.join(SCRIPT_DIR, "penpot.py")] * 16
    check("16 square locations -> 1 page", len(list(_dry_layout(imp, square, 750, 750, a3, gutter))) == 1)


def _dry_layout(imp, files, w, h, page_px, gutter):
    """Run layout()'s pagination without opening image files: patch Image.open/paste."""
    from PIL import Image
    orig_open = imp.Image.open
    imp.Image.open = lambda *_a, **_k: Image.new("RGB", (w, h), "white")
    try:
        yield from imp.layout(files, w, h, page_px, gutter, tick=35)
    finally:
        imp.Image.open = orig_open


if __name__ == "__main__":
    test_strip_design_balanced()
    test_var_substitution()
    test_blank_before_lists()
    test_badge_inline_stats()
    test_layout_packing()
    if _failures:
        print(f"\n{len(_failures)} FAILED: {', '.join(_failures)}")
        sys.exit(1)
    print("\nAll print-tooling tests passed.")
