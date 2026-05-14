# Card Rendering Pipeline

Penpot-based pipeline that renders card data from `library/` CSVs into PNG and SVG images.

## Pipeline flow

1. **`setup-template.py`** — Creates the unit card template in Penpot (shapes, colors, tokens, component)
2. **`compose-cards.py`** — Reads CSV data, populates the template per card, exports PNG/SVG
3. **`postprocess-svg.py`** — Cleans exported SVGs (rewrites fonts, strips artifacts, reduces size ~35%)

## tokens.json structure

- **`layout`**, **`colors`**, **`stats`**, **`typography`**, **`mappings`** — Used by the Python scripts to build and populate card shapes
- **`designTokens`** — W3C DTCG format tokens pushed to Penpot's token system via `set-tokens-lib`

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

# Build the template (first time only)
python3 design/setup-template.py

# Export all unit cards as PNG
python3 design/compose-cards.py
```

## Detailed API patterns

See [`.claude/skills/penpot-card-renderer/SKILL.md`](../.claude/skills/penpot-card-renderer/SKILL.md) for Penpot API usage, shape discovery, text content format, and troubleshooting.
