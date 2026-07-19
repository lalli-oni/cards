# Card Rendering Pipeline

Penpot-based pipeline that renders card data from `library/` CSVs into
printable PNG images.

## Pipeline flow

1. **`moderntrek-template.py`** — the renderer. Reads a card-type CSV, and for
   each card builds the card frame procedurally in Penpot (shapes, colours,
   keyword pills, action/passive blocks — no pre-built template needed),
   exports a PNG, and writes it to `exports/<set>/<type>-<id>.png`. Handles all
   five card types (unit, location, item, event, policy), auto-detected from the
   CSV filename. Creates a Penpot project + file on first run if none exists
   (saved to `.env`). Consumes the governed keyword vocabulary from
   `library/build/keywords.json` (run `bun library/build.ts` to regenerate).
2. **`build-gallery.py`** — scans `exports/<set>/` and assembles a static HTML
   gallery; **`publish-gallery.sh`** publishes it to the `gh-pages` branch.

Self-contained — the renderer carries its own colour palette and layout
constants; it does not read `tokens.json`.

> **Legacy:** the earlier template-based pipeline (`setup-template.py` +
> `compose-cards.py`, driven by `tokens.json`, with SVG export via
> `postprocess-svg.py`) was retired in favour of the single procedural renderer
> (#202). `tokens.json`, `postprocess-svg.py`, and `card-back.svg` remain as
> assets. SVG/vector export and card-back rendering are not yet ported to
> `moderntrek-template.py` — tracked as follow-ups.

## Prerequisites

- Docker & Docker Compose (for self-hosted Penpot)
- Python 3.9+
- Copy `design/.env.example` → `design/.env` and fill in credentials
- Generate a secret key: `python3 -c "import secrets; print(secrets.token_urlsafe(64))"`

## URLs

- **Penpot UI**: `http://localhost:$PENPOT_PORT` (default `9011`, configured in `design/.env`)
- **Mailcatch** (dev email): http://localhost:1080

To change the host port, edit `PENPOT_PORT` in `design/.env` — both docker-compose and the Python scripts read from there.

## Quick start

```bash
# Create .env with your credentials (do this first so docker-compose can read PENPOT_PORT and PENPOT_SECRET_KEY)
cp design/.env.example design/.env
# Edit design/.env with your email, password, and generated secret key

# Start Penpot (--env-file is required so PENPOT_PORT and PENPOT_SECRET_KEY are picked up)
docker compose -f design/docker-compose.yaml --env-file design/.env up -d

# Register an account at the Penpot UI (verification emails appear at http://localhost:1080)

# Setup Claude Code MCP integration (uses credentials from design/.env)
cp .mcp.json.example .mcp.json
# Edit .mcp.json and fill in PENPOT_USERNAME and PENPOT_PASSWORD from design/.env

# (Optional) diagnose the Penpot environment before rendering
python3 design/preflight.py            # add --fix to apply safe repairs

# Render all unit cards to exports/<set>/unit-<id>.png (defaults to alpha-1 units)
python3 design/moderntrek-template.py
# …or another type / set:
python3 design/moderntrek-template.py library/sets/alpha-1/locations.csv
```

## Detailed API patterns

See [`.claude/skills/penpot-card-renderer/SKILL.md`](../.claude/skills/penpot-card-renderer/SKILL.md) for Penpot API usage, shape building, text content format, and troubleshooting.
