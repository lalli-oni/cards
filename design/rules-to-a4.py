#!/usr/bin/env python3
"""Build a printable A4 rulebook PDF from the rules/ markdown.

This is a print artifact, not a rewrite: the prose is the real rules text,
typeset for reading. It applies these transforms so the design document reads
cleanly on paper:

  - strip [design:...] commentary (balanced brackets; they nest [var:...])
  - drop [var:section-id] heading markers (variant-section flags, no value)
  - replace [var:id:baseline] -> the baseline value, colour-coded so a reader
    sees at a glance which numbers are variant-tunable
  - reuse the card renderer's glyphs (gold cost coin, STR/CUN/CHA stat chips,
    rarity gems, AP/VP badges) in a Symbols key and inline for AP/VP

With PyMuPDF present it also builds a front-page table of contents with real page
numbers (two-pass render: measure heading pages, then re-render), stamps a page
number in the bottom-right of every page, and adds a PDF outline. Without it, the
PDF is still produced — just with a number-less contents list and no page numbers.

Requires the `markdown` package and a Chrome/Chromium binary (for --print-to-pdf);
`pymupdf` is optional (enables the TOC page numbers, page stamps, and outline).

Usage:   cd design && python3 rules-to-a4.py
         python3 rules-to-a4.py --out /tmp/rules.pdf
         python3 rules-to-a4.py --html-only        # emit HTML, skip the PDF step
"""

import argparse
import os
import re
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RULES_DIR = os.path.join(SCRIPT_DIR, "..", "rules")

# Reading order: master doc first, then the deeper files it links to. Meta files
# (design-principles, ideas, CLAUDE) are intentionally excluded — not gameplay.
FILES = ["README.md", "attributes.md", "stat-contests.md", "market.md", "policies.md"]

_LIST = re.compile(r"^\s*([-*+]|\d+\.)\s+")


def strip_design(text):
    """Remove every [design: ... ] block, honouring nested [ ] (they contain vars)."""
    out, i, n = [], 0, len(text)
    while i < n:
        if text.startswith("[design:", i):
            depth, j = 1, i + 1
            while j < n and depth:
                depth += {"[": 1, "]": -1}.get(text[j], 0)
                j += 1
            i = j
            while i < n and text[i] == " ":       # swallow a trailing space
                i += 1
        else:
            out.append(text[i])
            i += 1
    text = "".join(out)
    text = re.sub(r"(?m)^[ \t]*[-*][ \t]*$\n?", "", text)   # drop now-empty list items
    return re.sub(r"\n{3,}", "\n\n", text)


def blank_before_lists(text):
    """Insert a blank line before a list that directly follows a paragraph line.

    Several sections start a list on the line right after prose (e.g. "Main Phase
    with:" then "- ..."); markdown only opens a list after a blank line, so
    without this the bullets collapse into the paragraph. The previous line is
    left untouched when it is itself a list item (real nesting) or a heading.
    """
    lines, out = text.split("\n"), []
    for i, ln in enumerate(lines):
        if i and _LIST.match(ln):
            prev = lines[i - 1]
            if prev.strip() and not _LIST.match(prev) and not prev.lstrip().startswith("#") \
                    and out and out[-1].strip():
                out.append("")
        out.append(ln)
    return "\n".join(out)


def transform(text):
    text = strip_design(text)
    text = blank_before_lists(text)
    text = re.sub(r"\[\[([a-z_]+)\]\]", r"\1", text)                # [[controller]] -> controller
    text = re.sub(r"[ \t]*\[var:[a-z0-9_-]+\](?=\s|$)", "", text)   # section markers (no value)

    def var(m):
        vid, val = m.group(1), m.group(2)
        return (f'<span class="var" title="Variant-tunable ({vid}); baseline value shown">'
                f'{val}</span>')
    text = re.sub(r"\[var:([a-z_]+):([^\]]+)\]", var, text)         # [var:id:value] -> value

    # Cross-file links become in-document anchors (harmless on paper either way).
    return re.sub(r"\]\([a-z0-9_-]+\.md(#[a-z0-9-]+)?\)",
                  lambda m: f"]({m.group(1) or '#top'})", text)


def badge_inline_stats(html):
    """Wrap standalone AP / VP tokens in glyph badges, skipping tag interiors."""
    parts = re.split(r"(<[^>]+>)", html)
    for k in range(0, len(parts), 2):                              # even = text between tags
        parts[k] = re.sub(r"\bAP\b", '<span class="ico ap">AP</span>', parts[k])
        parts[k] = re.sub(r"\bVP\b", '<span class="ico vp">VP</span>', parts[k])
    return "".join(parts)


def find_chrome(override=None):
    """Locate a Chrome/Chromium binary for headless PDF printing."""
    for cand in filter(None, [override, os.environ.get("CHROME_BIN")]):
        if os.path.isfile(cand):
            return cand
    names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    for p in paths:
        if os.path.isfile(p):
            return p
    return None


CSS = """
:root{
  --ink:#16203a; --navy:#0f1a2e; --panel:#1c2a48; --muted:#5b6b86;
  --line:#d7deea; --limebright:#c8f562;
  --var:#0e6ba8; --varbg:#e6f2fb;
  --str:#d23c33; --cun:#2e7bd6; --cha:#6f8f16;
  --gold1:#ffe9a8; --gold2:#f4c24a; --gold3:#a3761a;
}
@page{ size:A4; margin:20mm 18mm; }
*{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html{ font-size:10.5pt; }
body{ font-family:-apple-system,"Helvetica Neue",Arial,sans-serif; color:var(--ink); line-height:1.5; }
/* Front matter (title+TOC, symbols key) each own a page; the rule chapters flow
   so short files don't each waste a page. Widow/orphan + break-after control
   stops a lone word or heading spilling onto an otherwise-blank page. */
.front{ page-break-after:always; }
.keypage{ page-break-after:always; }
.chapter + .chapter h1{ margin-top:1.6em; }
h1,h2,h3,h4{ break-after:avoid; }
p,li{ orphans:2; widows:2; }
table,blockquote{ break-inside:avoid; }
h1{ font-size:20pt; color:var(--navy); margin:0 0 .5em; letter-spacing:-.01em;
  border-bottom:2.5px solid var(--limebright); padding-bottom:.18em; }
h2{ font-size:15pt; color:var(--navy); margin:1.4em 0 .35em;
  border-bottom:1px solid var(--line); padding-bottom:.12em; }
h3{ font-size:12.5pt; color:var(--panel); margin:1.15em 0 .3em; }
h4{ font-size:11pt; color:var(--panel); margin:1em 0 .25em; text-transform:uppercase; letter-spacing:.04em; }
p{ margin:.5em 0; }
ul,ol{ margin:.4em 0 .6em 1.3em; padding:0; }
li{ margin:.18em 0; }
strong,b{ color:var(--navy); }
a{ color:var(--navy); text-decoration:none; border-bottom:1px dotted #9fb0c8; }
blockquote{ margin:.7em 0; padding:.4em .9em; background:#f4f7fb;
  border-left:3px solid var(--cun); color:#33435f; border-radius:0 4px 4px 0; }
blockquote p{ margin:.25em 0; }
code{ font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:.9em;
  background:#eef2f8; padding:.05em .35em; border-radius:3px; }
table{ border-collapse:collapse; width:100%; margin:.6em 0; font-size:9.6pt; }
th,td{ border:1px solid var(--line); padding:.34em .5em; text-align:left; vertical-align:top; }
th{ background:var(--navy); color:#fff; font-weight:600; }
tr:nth-child(even) td{ background:#f6f8fc; }
.var{ color:var(--var); background:var(--varbg); font-weight:700;
  padding:0 .28em; border-radius:3px; white-space:nowrap; }
.ico{ display:inline-block; font-weight:800; font-size:.82em; line-height:1;
  padding:.18em .34em; border-radius:4px; vertical-align:baseline; letter-spacing:.02em; }
.ico.ap{ background:var(--limebright); color:#33430a; }
.ico.vp{ background:var(--navy); color:#fff; }
.coin{ display:inline-flex; align-items:center; justify-content:center;
  width:1.7em; height:1.7em; border-radius:50%; font-weight:800; color:#3a2205;
  background:radial-gradient(circle at 38% 32%, var(--gold1), var(--gold2) 55%, var(--gold3));
  border:1px solid #8a6522; box-shadow:inset 0 0 2px rgba(255,255,255,.6); }
.stat{ display:inline-block; font-weight:800; font-size:.8em; color:#fff; padding:.16em .4em; border-radius:4px; }
.stat.str{ background:var(--str); } .stat.cun{ background:var(--cun); } .stat.cha{ background:var(--cha); }
.gem{ font-size:1.15em; }
.gem.common{ color:#6c7486; } .gem.uncommon{ color:#4a8fd1; }
.gem.epic{ color:#d9a441; } .gem.legendary{ color:#d9a441; }
.keytable td{ border:none; border-bottom:1px solid var(--line); padding:.55em .4em; }
.keytable td.sym{ width:5.2em; text-align:center; white-space:nowrap; font-size:1.05em; }
.lede{ color:#33435f; }
.note{ background:var(--varbg); border:1px solid #bfe0f5; border-radius:6px; padding:.5em .9em; margin:.7em 0; }
.note p{ margin:0; }
.titlewrap{ border-top:3px solid var(--limebright);
  border-bottom:3px solid var(--limebright); padding:9mm 0; margin-bottom:8mm; }
.kicker{ text-transform:uppercase; letter-spacing:.25em; color:var(--muted); font-size:11pt; font-weight:700; }
.booktitle{ font-size:42pt; border:none; margin:.08em 0; color:var(--navy); letter-spacing:-.02em; }
.subtitle{ font-size:14pt; color:#33435f; }
.foot{ margin-top:5mm; color:var(--muted); font-size:10pt; }
/* front-page table of contents: name — dotted leader — page number */
.toc-h{ font-size:12pt; text-transform:uppercase; letter-spacing:.14em;
  color:var(--muted); font-weight:700; margin:0 0 .6em; }
.toc-row{ display:flex; align-items:baseline; margin:.16em 0; font-size:10.5pt; }
.toc-row .nm{ color:var(--navy); }
.toc-row .dots{ flex:1; margin:0 .5em; border-bottom:1px dotted #b7c1d3; transform:translateY(-.18em); }
.toc-row .pg{ color:var(--muted); font-variant-numeric:tabular-nums; }
.toc-row.l1{ margin-top:.55em; }
.toc-row.l1 .nm{ font-weight:700; }
.toc-row.l2{ padding-left:1.1em; }
.toc-row.l2 .nm{ color:#33435f; }
"""

FRONT = """
<section class="front">
  <div class="titlewrap">
    <div class="kicker">Card Game &mdash; {set_name}</div>
    <h1 class="booktitle">Rules</h1>
    <div class="subtitle">Master rules, typeset for print</div>
    <div class="foot">Baseline variant &middot; values shown are the shipped defaults</div>
  </div>
  <div class="toc-h">Contents</div>
  {toc}
</section>
"""

KEY = """
<section class="keypage">
  <h1>Symbols &amp; Notation</h1>
  <p class="lede">This booklet is the game's design rules, typeset for reading.
  Two conventions to know before you start:</p>
  <div class="note">
    <p><b>Colour-coded numbers</b> like <span class="var">50</span> are
    <b>variant-tunable</b> baseline values &mdash; the default the game ships with, which
    an alternate variant may change. Read them as ordinary numbers; the colour just
    flags "this knob can move."</p>
  </div>
  <p class="lede">The icons below mirror what is printed on the cards.</p>
  <table class="keytable">
    <tr><td class="sym"><span class="coin">6</span></td>
        <td><b>Cost / Gold</b><br>The gold coin is a card's cost and the game's
        currency. Pay it to Buy from the market and to Deploy cards; earn it from
        income, missions, and policies.</td></tr>
    <tr><td class="sym"><span class="ico ap">AP</span></td>
        <td><b>Action Points</b><br><span class="var">3</span> per turn. Nearly every
        action (Deploy, Move, Attack, Attempt Mission&hellip;) costs AP.</td></tr>
    <tr><td class="sym"><span class="ico vp">VP</span></td>
        <td><b>Victory Points</b><br>Reach <span class="var">50</span> to win. Mostly
        earned by completing mission locations.</td></tr>
    <tr><td class="sym"><span class="stat str">STR</span></td>
        <td><b>Strength</b><br>The combat stat &mdash; drives the Attack action and
        strength contests (injure / kill).</td></tr>
    <tr><td class="sym"><span class="stat cun">CUN</span></td>
        <td><b>Cunning</b><br>A contest / check stat.</td></tr>
    <tr><td class="sym"><span class="stat cha">CHA</span></td>
        <td><b>Charisma</b><br>A contest / check stat; Untouchable keys off it in v0.1.</td></tr>
    <tr><td class="sym"><span class="gem common">&#9679;</span>
                        <span class="gem uncommon">&#9671;</span>
                        <span class="gem epic">&#9670;</span>
                        <span class="gem legendary">&#9733;</span></td>
        <td><b>Rarity</b><br>Common &#9679; &nbsp; Uncommon &#9671; &nbsp; Epic &#9670;
        &nbsp; Legendary &#9733;. Affects deck-building limits only &mdash; not cost or power.</td></tr>
  </table>
</section>
"""


def build_chapters(rules_dir):
    """Return (chapters_html, headings) where headings is an ordered list of
    (level, text) for every h1/h2 — the entries the TOC is built from."""
    import markdown
    md = markdown.Markdown(extensions=["extra", "toc", "attr_list"], tab_length=2)
    chapters, headings = [], []

    def walk(tokens):
        for t in tokens:
            if t["level"] <= 2:
                headings.append((t["level"], t["name"]))
            walk(t.get("children", []))

    for fn in FILES:
        with open(os.path.join(rules_dir, fn)) as f:
            md.reset()
            chapters.append(f'<section class="chapter">'
                            f'{badge_inline_stats(md.convert(transform(f.read())))}</section>')
            walk(md.toc_tokens)
    return "".join(chapters), headings


def toc_html(entries):
    """entries: list of (level, text, page-or-None) -> front-page TOC rows."""
    rows = []
    for level, text, page in entries:
        pg = "" if page is None else str(page)
        rows.append(f'<div class="toc-row l{level}"><span class="nm">{text}</span>'
                    f'<span class="dots"></span><span class="pg">{pg}</span></div>')
    return "".join(rows)


def build_html(chapters, front_toc, set_name):
    return (f'<!doctype html><html><head><meta charset="utf-8">'
            f'<title>Card Game — Rules ({set_name})</title><style>{CSS}</style></head>'
            f'<body>{FRONT.format(set_name=set_name, toc=front_toc)}{KEY}{chapters}</body></html>')


def render_pdf(chrome, html_path, pdf_path):
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", f"file://{os.path.abspath(html_path)}"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def locate_headings(pdf_path, headings):
    """0-based page index of each heading, found by scanning forward.

    Matches on heading-sized spans (h1=20pt, h2=15pt; body is 10.5pt) rather than
    a plain text search — otherwise the same names printed in the TOC or in body
    prose would match before the actual heading.
    """
    import fitz
    doc = fitz.open(pdf_path)
    big = []                                           # per page: set of heading texts
    for pg in doc:
        texts = set()
        for blk in pg.get_text("dict")["blocks"]:
            for line in blk.get("lines", []):
                for span in line["spans"]:
                    if span["size"] >= 13:
                        texts.add(span["text"].strip())
        big.append(texts)
    pages, cursor = [], 0
    for _level, text in headings:
        found = next((p for p in range(cursor, doc.page_count) if text in big[p]), cursor)
        pages.append(found)
        cursor = found
    doc.close()
    return pages


def finalize_pdf(pdf_path, entries):
    """Stamp a page number bottom-right on every page but the front, and add a
    PDF outline from the located headings. entries: (level, text, page1based)."""
    import fitz
    doc = fitz.open(pdf_path)
    for i, page in enumerate(doc):
        if i == 0:
            continue                                   # front/TOC page stays unnumbered
        box = fitz.Rect(page.rect.width - 60, page.rect.height - 34,
                        page.rect.width - 18, page.rect.height - 18)
        page.insert_textbox(box, str(i + 1), fontsize=9, fontname="helv",
                            color=(0.42, 0.47, 0.55), align=fitz.TEXT_ALIGN_RIGHT)
    doc.set_toc([[level, text, page] for level, text, page in entries])
    tmp = pdf_path + ".tmp"
    doc.save(tmp, garbage=4, deflate=True)
    doc.close()
    os.replace(tmp, pdf_path)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rules-dir", default=RULES_DIR, help="rules/ directory (default: ../rules)")
    ap.add_argument("--set", default="alpha-1", help="set label for the title page (default: alpha-1)")
    ap.add_argument("--out", default=os.path.join(SCRIPT_DIR, "exports", "rules-A4.pdf"),
                    help="output PDF (default: exports/rules-A4.pdf)")
    ap.add_argument("--html-only", action="store_true", help="write HTML next to --out and stop")
    ap.add_argument("--chrome", help="path to a Chrome/Chromium binary (else auto-detected)")
    args = ap.parse_args()

    try:
        chapters, headings = build_chapters(args.rules_dir)
    except ModuleNotFoundError:
        sys.exit("The 'markdown' package is required: pip install markdown")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    html_path = os.path.splitext(args.out)[0] + ".html"

    # Without page numbers yet, the TOC lists section names only. --html-only
    # (screen use) stops here; the print path fills the page numbers below.
    plain_toc = toc_html([(lvl, txt, None) for lvl, txt in headings])
    with open(html_path, "w") as f:
        f.write(build_html(chapters, plain_toc, args.set))

    if args.html_only:
        print(f"HTML -> {html_path}")
        return

    chrome = find_chrome(args.chrome)
    if not chrome:
        sys.exit("No Chrome/Chromium found. Set CHROME_BIN or pass --chrome; "
                 f"HTML was written to {html_path}.")

    try:
        import fitz  # noqa: F401
    except ModuleNotFoundError:
        # No PyMuPDF: still produce a PDF, just without page numbers / a paginated
        # TOC. The front page then carries the section list without numbers.
        render_pdf(chrome, html_path, args.out)
        print(f"Rules -> {args.out}  (install pymupdf for page numbers + TOC pages)")
        return

    # Pass 1: render with a number-less TOC to measure where each heading lands.
    # The front page is forced to exactly one page (page-break-after), so filling
    # the TOC in pass 2 can't shift any later page — the measured pages stay valid.
    scratch = os.path.splitext(args.out)[0] + ".pass1.pdf"
    render_pdf(chrome, html_path, scratch)
    pages = locate_headings(scratch, headings)                 # 0-based indices
    os.remove(scratch)
    entries = [(lvl, txt, pg + 1) for (lvl, txt), pg in zip(headings, pages)]

    # Pass 2: re-render with page numbers in the TOC, then stamp + outline.
    with open(html_path, "w") as f:
        f.write(build_html(chapters, toc_html(entries), args.set))
    render_pdf(chrome, html_path, args.out)
    finalize_pdf(args.out, entries)
    print(f"Rules -> {args.out}  ({len(entries)} TOC entries)")


if __name__ == "__main__":
    main()
