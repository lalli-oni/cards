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

- **Penpot UI**: http://localhost:9001
- **Mailcatch** (dev email): http://localhost:1080

## Quick start

```bash
# Start Penpot
docker compose -f design/docker-compose.yaml up -d

# Create .env with your credentials
cp design/.env.example design/.env
# Edit design/.env with your email, password, and generated secret key

# Register an account at http://localhost:9001 (verification emails appear at http://localhost:1080)

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
