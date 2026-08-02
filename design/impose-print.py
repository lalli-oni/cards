#!/usr/bin/env python3
"""Impose already-rendered card PNGs onto print sheets at true physical size.

Reads `exports/<set>/<type>-<id>.png` (produced by moderntrek-template.py) and
tiles the cards 1:1 — no scaling — onto A3 (default) pages with corner crop marks
for guillotining, emitting a single print-ready PDF. The renderer emits 750x1050
portrait cards and 750x750 square locations, which at 300 DPI are exactly
63.5x88.9mm (standard poker) and 63.5mm square. Cards sharing a width share
columns; rows of differing heights are then packed together onto each sheet
(first-fit-decreasing) to minimise paper — so a single sheet may cut to two
different card sizes (poker and square are the same width here).

Usage:   cd design && python3 impose-print.py            # alpha-1 -> A3
         python3 impose-print.py alpha-1 --paper a4
         python3 impose-print.py alpha-1 --out /tmp/cards.pdf
"""

import argparse
import collections
import glob
import os
import sys

from PIL import Image, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORTS = os.path.join(SCRIPT_DIR, "exports")

# Paper sizes in millimetres (portrait).
PAPER = {"a3": (297, 420), "a4": (210, 297), "letter": (215.9, 279.4)}

MARGIN_MM = 8.0        # top/bottom margin kept clear of cards
CARD_W_MM = 63.5       # every card (poker + square) is one poker-width wide


def page_metrics(paper, dpi):
    """Pixel page size and the usable vertical budget for a paper/DPI pair.

    Extracted so tests can assert the same margin/budget math main() runs on,
    instead of re-deriving it (and silently diverging when the formula changes).
    """
    mm = dpi / 25.4
    pw, ph = (round(d * mm) for d in PAPER[paper])
    budget_h = ph - 2 * round(MARGIN_MM * mm)
    return pw, ph, budget_h


def make_rows(groups, page_w, gutter):
    """Chunk each card size into full-width rows: {w, h, files}.

    Cards of the same width share columns, so a row is `cols` cards of one size.
    Rows of different heights can then coexist on a page (see paginate) — poker
    and square cards are the same width here, so square rows top up the sheet the
    tall cards leave partly empty instead of starting a fresh page.
    """
    rows = []
    for (w, h) in sorted(groups, key=lambda s: -s[1]):        # tallest size first
        cols = max(1, (page_w + gutter) // (w + gutter))
        files = sorted(groups[(w, h)])
        for i in range(0, len(files), cols):
            rows.append({"w": w, "h": h, "files": files[i:i + cols]})
    return rows


def paginate(rows, budget_h, gutter):
    """First-fit-decreasing pack rows (by height) into pages of budget_h.

    Tall rows go down first; short rows fill the vertical gaps they leave, which
    minimises the sheet count. Returns a list of pages, each a list of rows.
    """
    pages = []
    for row in sorted(rows, key=lambda r: -r["h"]):
        for page in pages:
            used = sum(r["h"] for r in page) + gutter * (len(page) - 1)
            if used + gutter + row["h"] <= budget_h:
                page.append(row)
                break
        else:
            pages.append([row])
    return pages


def draw_page(rows, page_px, gutter, tick):
    """Render one page: rows stacked and vertically centred, cards left-to-right
    within a row, each card cornered with crop marks."""
    pw, ph = page_px
    rows = sorted(rows, key=lambda r: -r["h"])                # tall rows at the top
    total_h = sum(r["h"] for r in rows) + gutter * (len(rows) - 1)
    y = (ph - total_h) // 2
    page = Image.new("RGB", page_px, "white")
    draw = ImageDraw.Draw(page)
    for row in rows:
        w, h = row["w"], row["h"]
        n = len(row["files"])                                 # center the row's actual
        ox = (pw - (n * w + (n - 1) * gutter)) // 2           # cards, not a full column
        for c, path in enumerate(row["files"]):
            x = ox + c * (w + gutter)
            page.paste(load_rgb(path), (x, y))
            for cx, cy in ((x, y), (x + w, y), (x, y + h), (x + w, y + h)):
                sx = -1 if cx == x else 1
                sy = -1 if cy == y else 1
                draw.line([(cx + sx * 2, cy), (cx + sx * tick, cy)], fill="black", width=2)
                draw.line([(cx, cy + sy * 2), (cx, cy + sy * tick)], fill="black", width=2)
        y += h + gutter
    return page


def collect(set_name):
    """Top-level card PNGs for a set (skips subdirs like print/ and _archive)."""
    set_dir = os.path.join(EXPORTS, set_name)
    if not os.path.isdir(set_dir):
        sys.exit(f"No exports for set '{set_name}' at {set_dir} — run the renderer first.")
    return sorted(f for f in glob.glob(os.path.join(set_dir, "*.png")))


def image_size(path):
    """(w, h) of a PNG, exiting with the filename on a corrupt/truncated file."""
    try:
        with Image.open(path) as im:
            return im.size
    except (OSError, ValueError) as e:                        # incl. UnidentifiedImageError
        sys.exit(f"Could not read card image {path}: {e}")


def load_rgb(path):
    """Open and decode a card PNG as RGB, exiting with the filename on error."""
    try:
        with Image.open(path) as im:
            return im.convert("RGB")
    except (OSError, ValueError) as e:
        sys.exit(f"Could not read card image {path}: {e}")


def validate_sizes(groups, pw, budget_h, dpi):
    """Fail loudly on cards that can't be placed 1:1, or that look mis-scaled.

    An oversized card would otherwise be silently clipped by draw_page (negative
    offsets push it and its crop marks off the sheet); a card whose width doesn't
    match CARD_W_MM at this DPI means the PNGs and --dpi disagree, so the "true
    physical size" guarantee is void — warn rather than print the wrong size.
    """
    expected_w = round(CARD_W_MM * dpi / 25.4)
    for (w, h), files in groups.items():
        if w > pw or h > budget_h:
            sys.exit(f"Card {w}x{h}px does not fit a {pw}px-wide sheet with a "
                     f"{budget_h}px vertical budget (e.g. {files[0]}). "
                     f"Use larger --paper or a lower --dpi.")
        if abs(w - expected_w) > 2:
            print(f"warning: card width {w}px != {expected_w}px expected for "
                  f"{CARD_W_MM}mm at {dpi} DPI — cards may print at the wrong "
                  f"physical size (e.g. {files[0]}).", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("set", nargs="?", default="alpha-1", help="card set (default: alpha-1)")
    ap.add_argument("--paper", choices=PAPER, default="a3", help="paper size (default: a3)")
    ap.add_argument("--dpi", type=int, default=300, help="render DPI (default: 300)")
    ap.add_argument("--gutter-mm", type=float, default=4.0, help="gap between cards (default: 4)")
    ap.add_argument("--tick-mm", type=float, default=3.0, help="crop-mark length (default: 3)")
    ap.add_argument("--out", help="output PDF (default: exports/<set>/print/<set>-cards-<paper>.pdf)")
    args = ap.parse_args()

    mm = args.dpi / 25.4
    pw, ph, budget_h = page_metrics(args.paper, args.dpi)
    gutter, tick = round(args.gutter_mm * mm), round(args.tick_mm * mm)

    files = collect(args.set)
    if not files:
        sys.exit(f"No card PNGs under {os.path.join(EXPORTS, args.set)}.")

    groups = collections.defaultdict(list)
    for f in files:
        groups[image_size(f)].append(f)
    validate_sizes(groups, pw, budget_h, args.dpi)

    layout = paginate(make_rows(groups, pw, gutter), budget_h, gutter)
    pages = [draw_page(rows, (pw, ph), gutter, tick) for rows in layout]

    out = args.out or os.path.join(EXPORTS, args.set, "print",
                                   f"{args.set}-cards-{args.paper}.pdf")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=args.dpi)
    if not os.path.getsize(out):
        sys.exit(f"Wrote an empty PDF to {out} — imposition produced no output.")
    print(f"{len(files)} cards -> {len(pages)} {args.paper.upper()} page(s) -> {out}")


if __name__ == "__main__":
    main()
