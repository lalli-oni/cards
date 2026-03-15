---
name: penpot-card-renderer
description: Render card game cards via the self-hosted Penpot instance. Use for creating/updating card templates, batch-exporting cards as PNG/SVG, inspecting the template state, and troubleshooting the rendering pipeline.
---

# Penpot Card Renderer

Manage the Penpot-based card rendering pipeline: template creation, batch card export, and design token management.

## Arguments
- Free-form request about card rendering (e.g. "export all unit cards as PNG", "recreate the template", "add a new stat box", "export Ada Lovelace as SVG", "show the current template shape IDs")

## Architecture

```
design/
  tokens.json          # All design values (colors, layout, typography, stats)
  penpot.py            # Shared module: PenpotClient, shape builders, geometry
  setup-template.py    # Creates the unit card template in Penpot (idempotent)
  compose-cards.py     # Populates template with CSV data, exports PNG/SVG
  postprocess-svg.py   # SVG cleanup for web (font rewrites, size reduction)
  .env                 # Credentials (gitignored, see .env.example)
```

## Prerequisites
- Penpot must be running: `docker compose -f design/docker-compose.yaml up -d`
- Verify: `curl -s -o /dev/null -w '%{http_code}' http://localhost:9001` should return 200
- `design/.env` must exist with credentials (copy from `design/.env.example`)

## Workflows

### 1. Create or rebuild the card template

```bash
cd design && python3 setup-template.py
```

This is **idempotent** — it deletes existing shapes by name and recreates them. Run it after changing `tokens.json` layout values. If no `PENPOT_FILE_ID` is set, it creates a new project and file.

After running, note the file ID printed and set it in `design/.env`:
```
PENPOT_FILE_ID=<the-id-printed>
```

### 2. Export cards as PNG

```bash
cd design && python3 compose-cards.py
```

Defaults to `library/sets/alpha-1/units.csv`, PNG format, output in `design/exports/`.

### 3. Export cards as SVG (with post-processing)

```bash
cd design && python3 compose-cards.py --format svg
```

SVGs are automatically post-processed by `postprocess-svg.py` (Google Fonts, stripped textLength, ~34% smaller).

### 4. Export both PNG and SVG

```bash
cd design && python3 compose-cards.py --format both
```

### 5. Export a different CSV

```bash
cd design && python3 compose-cards.py ../library/sets/alpha-1/locations.csv --format png
```

### 6. Modify design tokens

Edit `design/tokens.json`, then re-run `setup-template.py` to apply changes. Key sections:
- `colors` — all fill/stroke colors
- `layout` — x/y/w/h for every shape
- `typography.roles` — font size/weight/align per text role
- `stats` — stat names, colors, labels
- `mappings` — attribute initials, rarity colors

### 7. Inspect current template state

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

1. **`position-data` is required for SVG export** — text shapes must have approximate position-data or the SVG exporter times out. The `make_position_data()` function in `penpot.py` generates calibrated approximations.
2. **`text-align` at BOTH paragraph AND text-attrs level** — centering only works when set in both places.
3. **Delete+re-add for repositioning** — `mod-obj` cannot update `selrect` (needs Rect record instance). Use `reposition_shape()`.
4. **Design tokens as JSON string** — `set-tokens-lib` `tokens-lib` value must be `json.dumps()`, not inline object, because Penpot's JSON middleware strips `$` from keys.
5. **Shape z-order = add order** — later additions render on top.
6. **Transit+JSON for exports** — content type `application/transit+json`, two-step (create export, download asset URI).
7. **`grow-type: "fixed"` on text shapes** — ensures consistent rendering.

## Rules
- Always `cd design` before running scripts (they use relative imports)
- Never hardcode shape UUIDs — use `find_shapes_by_name()` to discover shapes at runtime
- After modifying `tokens.json`, always re-run `setup-template.py` before exporting
- The template must exist before `compose-cards.py` can run — run `setup-template.py` first
- Check Penpot is running before any operation
- Card data lives in `library/sets/{set}/{type}.csv` — read with nushell or Python csv module
- The `.env` file is gitignored — credentials must never be committed
