#!/usr/bin/env python3
"""Impose already-rendered card PNGs onto print sheets at true physical size.

Reads `exports/<set>/<type>-<id>.png` (produced by moderntrek-template.py) and
tiles the cards 1:1 — no scaling — onto A3 (default) pages with corner crop marks
for guillotining, emitting a single print-ready PDF. The renderer emits 750x1050
portrait cards and 750x750 square locations, which at 300 DPI are exactly
63.5x88.9mm (standard poker) and 63.5mm square; cards of different sizes are
grouped onto their own pages so every cell on a sheet cuts to the same size.

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


def layout(files, card_w, card_h, page_px, gutter, tick):
    """Yield page images packing card_w x card_h cells with corner crop marks."""
    pw, ph = page_px
    cols = max(1, (pw + gutter) // (card_w + gutter))
    rows = max(1, (ph + gutter) // (card_h + gutter))
    per = cols * rows
    grid_w = cols * card_w + (cols - 1) * gutter
    grid_h = rows * card_h + (rows - 1) * gutter
    ox = (pw - grid_w) // 2
    oy = (ph - grid_h) // 2
    for start in range(0, len(files), per):
        page = Image.new("RGB", page_px, "white")
        draw = ImageDraw.Draw(page)
        for i, path in enumerate(files[start:start + per]):
            r, c = divmod(i, cols)
            x = ox + c * (card_w + gutter)
            y = oy + r * (card_h + gutter)
            page.paste(Image.open(path).convert("RGB"), (x, y))
            for cx, cy in ((x, y), (x + card_w, y), (x, y + card_h), (x + card_w, y + card_h)):
                sx = -1 if cx == x else 1
                sy = -1 if cy == y else 1
                draw.line([(cx + sx * 2, cy), (cx + sx * tick, cy)], fill="black", width=2)
                draw.line([(cx, cy + sy * 2), (cx, cy + sy * tick)], fill="black", width=2)
        yield page


def collect(set_name):
    """Top-level card PNGs for a set (skips subdirs like print/ and _archive)."""
    set_dir = os.path.join(EXPORTS, set_name)
    if not os.path.isdir(set_dir):
        sys.exit(f"No exports for set '{set_name}' at {set_dir} — run the renderer first.")
    return sorted(f for f in glob.glob(os.path.join(set_dir, "*.png")))


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
    page_px = tuple(round(d * mm) for d in PAPER[args.paper])
    gutter, tick = round(args.gutter_mm * mm), round(args.tick_mm * mm)

    files = collect(args.set)
    if not files:
        sys.exit(f"No card PNGs under {os.path.join(EXPORTS, args.set)}.")

    groups = collections.defaultdict(list)
    for f in files:
        groups[Image.open(f).size].append(f)

    pages = []
    for size in sorted(groups, key=lambda s: -s[1]):          # tallest (portrait) first
        pages += list(layout(sorted(groups[size]), size[0], size[1], page_px, gutter, tick))

    out = args.out or os.path.join(EXPORTS, args.set, "print",
                                   f"{args.set}-cards-{args.paper}.pdf")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=args.dpi)
    print(f"{len(files)} cards -> {len(pages)} {args.paper.upper()} page(s) -> {out}")


if __name__ == "__main__":
    main()
