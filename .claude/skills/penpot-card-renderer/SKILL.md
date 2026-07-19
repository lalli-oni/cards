---
name: penpot-card-renderer
description: Render card game cards via the self-hosted Penpot instance. Use for batch-exporting cards as printable PNGs, adjusting the card layout/rendering, inspecting Penpot state, and troubleshooting the rendering pipeline.
---

# Penpot Card Renderer

Manage the Penpot-based card rendering pipeline: batch card export and layout
work. A single procedural renderer (`moderntrek-template.py`) builds each card's
frame from scratch and exports a PNG — there is no separate template-creation
step.

## Arguments
- Free-form request about card rendering (e.g. "export all unit cards", "render the locations", "adjust the keyword pill layout", "show the current Penpot shapes")

## Architecture

```
design/
  penpot.py               # Shared module: PenpotClient, shape builders, geometry, text wrapping
  moderntrek-template.py  # The renderer: builds each card frame procedurally + exports PNG (all 5 types)
  build-gallery.py        # Assembles exports/<set>/ PNGs into a static HTML gallery
  publish-gallery.sh      # Publishes the gallery to the gh-pages branch
  preflight.py            # Doctor for the Penpot env (.env, stack, login, file id); --fix repairs
  exports/<set>/          # Rendered <type>-<id>.png output
  .env                    # Credentials (gitignored, see .env.example)
```

The renderer is self-contained: it carries its own colour palette + layout
constants (top of `moderntrek-template.py`) and does **not** read `tokens.json`.
It consumes the governed keyword vocabulary from `library/build/keywords.json`
(regenerate with `bun library/build.ts`) to render keyword pills + reminder text.

> **Legacy:** `setup-template.py` + `compose-cards.py` (the `tokens.json`-driven
> template pipeline) and SVG export were retired in #202. `tokens.json`,
> `postprocess-svg.py`, and `card-back.svg` remain as assets; SVG/vector export
> and card-back rendering are not yet ported to the renderer (follow-ups).

## Prerequisites
- `design/.env` must exist with credentials and `PENPOT_PORT` (copy from `design/.env.example`)
- Penpot must be running: `docker compose -f design/docker-compose.yaml --env-file design/.env up -d`
- Verify: `curl -s -o /dev/null -w '%{http_code}' "http://localhost:$(grep ^PENPOT_PORT design/.env | cut -d= -f2)"` should return 200 (default port is 9011)
- Or run `python3 design/preflight.py` (add `--fix` to apply safe repairs) to diagnose the whole environment at once

## Workflows

### 1. Render a card type to PNG

```bash
python3 design/moderntrek-template.py                                    # defaults to alpha-1 units.csv
python3 design/moderntrek-template.py library/sets/alpha-1/locations.csv # any type, auto-detected from filename
```

Each card's frame is rebuilt procedurally and exported to
`exports/<set>/<type>-<id>.png`. The card type is inferred from the CSV filename
(`units` → unit, `locations` → location, …). If `PENPOT_FILE_ID` is unset, a new
project + file is created and saved to `.env` on first run.

### 2. Render the whole set

```bash
for f in library/sets/alpha-1/*.csv; do python3 design/moderntrek-template.py "$f"; done
```

### 3. Build + publish the gallery

```bash
python3 design/build-gallery.py        # scans exports/<set>/ → design/gallery/
bash design/publish-gallery.sh         # publishes to the gh-pages branch
```

### 4. Adjust the card layout / rendering

Edit `moderntrek-template.py` directly — the colour palette (`C`), layout
constants, and the per-type `build_*_shapes` functions live there. Re-run the
renderer to see changes. Keyword reminder prose is composed from
`library/build/keywords.json`; its templates are the source of truth in
`engine/src/keywords.ts` (rebuild with `bun library/build.ts`).

### 5. Inspect current Penpot state

```python
cd design && python3 -c "
from penpot import PenpotClient
c = PenpotClient()
c.login()
import os
fd = c.get_file(os.environ['PENPOT_FILE_ID'])
page_id = fd['data']['pages'][0]
objs = c.get_page_objects(fd, page_id)
for oid, obj in objs.items():
    if obj.get('parentId') != oid:
        print(f'{obj.get(\"type\"):6s} {obj.get(\"name\")}: {oid}')
"
```

## Key Penpot API Patterns

These are hard-won learnings — do NOT change without understanding the consequences:

1. **`position-data` is required for SVG export** — text shapes must have approximate position-data or the SVG exporter times out. The `make_position_data()` function in `penpot.py` generates calibrated approximations. (Relevant if SVG export is reintroduced.)
2. **`text-align` at BOTH paragraph AND text-attrs level** — centering only works when set in both places.
3. **Delete+re-add for repositioning** — `mod-obj` cannot update `selrect` (needs Rect record instance).
4. **Shape z-order = add order** — later additions render on top.
5. **Transit+JSON for exports** — content type `application/transit+json`, two-step (create export, download asset URI).
6. **`grow-type: "fixed"` on text shapes** — ensures consistent rendering.

## Rules
- Always `cd design` before running scripts (they use relative imports)
- Never hardcode shape UUIDs — the renderer names every shape and rebuilds the frame each run
- Card data lives in `library/sets/{set}/{type}.csv` — read with nushell or Python csv module
- Rebuild `library/build/keywords.json` (`bun library/build.ts`) after changing keyword definitions, so pills + reminder text stay current
- Check Penpot is running before any operation (or run `preflight.py`)
- The `.env` file is gitignored — credentials must never be committed
