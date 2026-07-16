#!/usr/bin/env python3
"""Generate a static HTML gallery of the rendered cards (for GitHub Pages).

Scans design/exports/<set>/<type>-<id>.png, copies the PNGs into
design/gallery/cards/<set>/, and writes a self-contained design/gallery/index.html
(no external dependencies) — a responsive, dark-themed masonry gallery sorted by
card type (with type filter buttons) and click-to-zoom. Display names + rarity
come from the library CSVs.

Usage:   cd design && python3 build-gallery.py
Publish: design/publish-gallery.sh   (pushes design/gallery/ to the gh-pages branch)
"""

import csv
import html
import os
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORTS = os.path.join(SCRIPT_DIR, "exports")
LIB_SETS = os.path.join(SCRIPT_DIR, "..", "library", "sets")
OUT = os.path.join(SCRIPT_DIR, "gallery")

TYPE_ORDER = ["unit", "location", "item", "event", "policy"]
TYPE_LABEL = {"unit": "Units", "location": "Locations", "item": "Items",
              "event": "Events", "policy": "Policies"}
TYPE_STEM = {"unit": "units", "location": "locations", "item": "items",
             "event": "events", "policy": "policies"}
RARITY_COLOR = {"common": "#6c7486", "uncommon": "#4a8fd1", "rare": "#4a8fd1",
                "epic": "#b07cf1", "legendary": "#f4c24a"}


def load_meta(set_name):
    """id -> {'name', 'rarity'} from the set's per-type CSVs."""
    meta = {}
    for stem in TYPE_STEM.values():
        path = os.path.join(LIB_SETS, set_name, f"{stem}.csv")
        if not os.path.isfile(path):
            continue
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                cid = row.get("id")
                if not cid:
                    print(f"WARNING: {path} has a row with no id — skipping",
                          file=sys.stderr)
                    continue
                meta[cid] = {"name": row.get("name", cid),
                             "rarity": (row.get("rarity") or "").lower()}
    return meta


def collect():
    """Return {set_name: [ {type, id, name, rarity, file} ... ]}."""
    out = {}
    if not os.path.isdir(EXPORTS):
        return out              # never rendered yet — main() prints the guidance
    for set_name in sorted(os.listdir(EXPORTS)):
        set_dir = os.path.join(EXPORTS, set_name)
        if not os.path.isdir(set_dir) or set_name.startswith("_"):
            continue
        meta = load_meta(set_name)
        cards = []
        for fn in os.listdir(set_dir):
            if not fn.endswith(".png"):
                continue
            ctype, _, cid = fn[:-4].partition("-")
            if ctype not in TYPE_ORDER or not cid:
                print(f"WARNING: {set_name}/{fn} doesn't match <type>-<id>.png "
                      f"— skipping", file=sys.stderr)
                continue
            m = meta.get(cid)
            if m is None:               # PNG with no library row (stale export / id mismatch)
                print(f"WARNING: {set_name}/{fn}: no library entry for id "
                      f"'{cid}' — using a derived name and no rarity", file=sys.stderr)
                m = {}
            cards.append({"type": ctype, "id": cid, "file": fn,
                          "name": m.get("name", cid.replace("-", " ").title()),
                          "rarity": m.get("rarity", "")})
        if cards:
            cards.sort(key=lambda c: (TYPE_ORDER.index(c["type"]), c["name"].lower()))
            out[set_name] = cards
    return out


PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cords — card gallery</title>
<style>
  :root {{ --bg:#0a1220; --panel:#0f1a2e; --line:#1a2540; --lime:#c8f562;
          --text:#e6ecf6; --muted:#7a8aa6; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text);
    font-family:'Space Grotesk',system-ui,-apple-system,sans-serif; }}
  header {{ position:sticky; top:0; z-index:10; background:rgba(10,18,32,.92);
    backdrop-filter:blur(8px); border-bottom:1px solid var(--line); padding:18px 22px; }}
  h1 {{ margin:0 0 4px; font-size:20px; letter-spacing:-.01em; }}
  h1 b {{ color:var(--lime); }}
  .sub {{ color:var(--muted); font-size:12.5px;
    font-family:'JetBrains Mono',ui-monospace,monospace; letter-spacing:.12em; }}
  nav {{ margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; }}
  .filter {{ font:600 11px/1 'JetBrains Mono',ui-monospace,monospace; letter-spacing:.14em;
    text-transform:uppercase; color:var(--muted); background:transparent;
    border:1px solid var(--line); border-radius:999px; padding:8px 14px; cursor:pointer; }}
  .filter:hover {{ color:var(--text); }}
  .filter.active {{ color:#0a1220; background:var(--lime); border-color:var(--lime); }}
  .filter span {{ opacity:.6; margin-left:6px; }}
  main {{ padding:22px; column-width:250px; column-gap:16px; }}
  figure {{ margin:0 0 16px; break-inside:avoid; background:var(--panel);
    border:1px solid var(--line); border-radius:12px; overflow:hidden; cursor:zoom-in; }}
  figure img {{ display:block; width:100%; height:auto; }}
  figcaption {{ padding:10px 12px; display:flex; align-items:center; gap:8px; }}
  figcaption .nm {{ font-size:14px; font-weight:600; }}
  figcaption .rr {{ margin-left:auto; width:9px; height:9px; border-radius:2px;
    transform:rotate(45deg); }}
  .empty {{ color:var(--muted); padding:40px; text-align:center; }}
  #lb {{ position:fixed; inset:0; background:rgba(4,8,16,.94); display:none;
    align-items:center; justify-content:center; z-index:100; cursor:zoom-out; padding:24px; }}
  #lb img {{ max-width:min(95vw,780px); max-height:95vh; border-radius:14px;
    box-shadow:0 20px 60px rgba(0,0,0,.6); }}
</style></head>
<body>
<header>
  <h1><b>cords</b> — card gallery</h1>
  <div class="sub">{count} CARDS · {set_label}</div>
  <nav id="filters">{filters}</nav>
</header>
<main id="grid">{cards}</main>
<div class="empty" id="empty" hidden>No cards for this filter.</div>
<div id="lb"><img alt=""></div>
<script>
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const lb = document.getElementById('lb'), lbimg = lb.querySelector('img');
  document.getElementById('filters').addEventListener('click', e => {{
    const b = e.target.closest('.filter'); if (!b) return;
    document.querySelectorAll('.filter').forEach(f => f.classList.toggle('active', f === b));
    const t = b.dataset.type; let shown = 0;
    grid.querySelectorAll('figure').forEach(fig => {{
      const on = t === 'all' || fig.dataset.type === t;
      fig.hidden = !on; if (on) shown++;
    }});
    empty.hidden = shown > 0;
  }});
  grid.addEventListener('click', e => {{
    const img = e.target.closest('figure'); if (!img) return;
    lbimg.src = img.querySelector('img').src; lb.style.display = 'flex';
  }});
  lb.addEventListener('click', () => lb.style.display = 'none');
  addEventListener('keydown', e => {{ if (e.key === 'Escape') lb.style.display = 'none'; }});
</script>
</body></html>
"""


def main():
    data = collect()
    if not data:
        print("No cards found under design/exports/<set>/ — run the renderer first.",
              file=sys.stderr)
        # Non-zero so publish-gallery.sh (set -e) aborts instead of republishing
        # a stale gallery/ from a previous run.
        sys.exit(1)

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "cards"))

    all_cards, counts, sets = [], {t: 0 for t in TYPE_ORDER}, []
    for set_name, cards in data.items():
        sets.append(set_name)
        dst = os.path.join(OUT, "cards", set_name)
        os.makedirs(dst, exist_ok=True)
        for c in cards:
            shutil.copy2(os.path.join(EXPORTS, set_name, c["file"]),
                         os.path.join(dst, c["file"]))
            counts[c["type"]] += 1
            src = f"cards/{set_name}/{c['file']}"
            rr = RARITY_COLOR.get(c["rarity"], "transparent")
            all_cards.append(
                f'<figure data-type="{c["type"]}">'
                f'<img loading="lazy" src="{html.escape(src)}" '
                f'alt="{html.escape(c["name"])}">'
                f'<figcaption><span class="nm">{html.escape(c["name"])}</span>'
                f'<span class="rr" style="background:{rr}" '
                f'title="{html.escape(c["rarity"])}"></span></figcaption></figure>')

    total = sum(counts.values())
    filters = [f'<button class="filter active" data-type="all">All'
               f'<span>{total}</span></button>']
    for t in TYPE_ORDER:
        if counts[t]:
            filters.append(f'<button class="filter" data-type="{t}">'
                           f'{TYPE_LABEL[t]}<span>{counts[t]}</span></button>')

    page = PAGE.format(count=total, set_label=", ".join(sets).upper(),
                       filters="".join(filters), cards="".join(all_cards))
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(page)
    print(f"Gallery built: {total} cards across {len(sets)} set(s) -> {OUT}/index.html")


if __name__ == "__main__":
    main()
