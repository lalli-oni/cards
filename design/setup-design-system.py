#!/usr/bin/env python3
"""
Set up the Penpot file with proper design system assets:
- Library colors (named palette)
- Typographies (text style presets)
- Design tokens (semantic token sets with themes)
- Component registration (Unit Card as reusable component)

Then applies tokens to existing template shapes.

Usage:
    python3 setup-design-system.py
"""

import json
import uuid
import urllib.request
import urllib.error
import http.cookiejar
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_URL = "http://localhost:9001"
API = f"{BASE_URL}/api/rpc/command"
EMAIL = "lalli.oni@gmail.com"
PASSWORD = "King-Gradation-Clique-Essential"

FILE_ID = "e2415290-ef6d-8198-8007-b6bb3c40b7e8"
PAGE_ID = "e2415290-ef6d-8198-8007-b6bb3c40b7e9"
CARD_FRAME_ID = "c98e8b25-99cc-4912-9e34-cbda71eba131"

FEATURES = [
    "fdata/objects-map", "fdata/shape-data-type", "fdata/path-data",
    "components/v2", "styles/v2", "design-tokens/v1", "variants/v1",
    "layout/grid", "plugins/runtime",
]

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def api_post(endpoint, payload):
    url = f"{API}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with opener.open(req) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"ERROR {exc.code} from {endpoint}: {body[:500]}", file=sys.stderr)
        sys.exit(1)


def uid():
    return str(uuid.uuid4())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Design system definitions
# ---------------------------------------------------------------------------

# -- Colors --
COLORS = {
    # Card structure
    "card/background":      {"color": "#1a1a2e", "opacity": 1},
    "card/inner-border":     {"color": "#2d2d44", "opacity": 1},
    "card/border-stroke":    {"color": "#3d3d5c", "opacity": 1},
    "card/text-area":        {"color": "#252540", "opacity": 1},
    "card/art-placeholder":  {"color": "#4a4a6a", "opacity": 1},
    "card/art-stroke":       {"color": "#5a5a7a", "opacity": 1},

    # Stats
    "stats/strength":        {"color": "#dc2626", "opacity": 1},
    "stats/cunning":         {"color": "#2563eb", "opacity": 1},
    "stats/charisma":        {"color": "#16a34a", "opacity": 1},

    # UI elements
    "ui/cost-box":           {"color": "#d4a843", "opacity": 1},
    "ui/attribute-circle":   {"color": "#3b82f6", "opacity": 1},
    "ui/keywords-bar":       {"color": "#1a1a2e", "opacity": 0.5},
    "ui/type-banner":        {"color": "#1a1a2e", "opacity": 1},

    # Text colors
    "text/primary":          {"color": "#ffffff", "opacity": 1},
    "text/secondary":        {"color": "#ccccdd", "opacity": 1},
    "text/flavor":           {"color": "#9999bb", "opacity": 1},
    "text/cost":             {"color": "#000000", "opacity": 1},
}

# -- Typographies --
TYPOGRAPHIES = {
    "Card Title": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "700",
        "fontSize": "28",
        "fontWeight": "700",
        "fontStyle": "normal",
        "lineHeight": "1.2",
        "letterSpacing": "0",
        "textTransform": "none",
    },
    "Cost Value": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "700",
        "fontSize": "22",
        "fontWeight": "700",
        "fontStyle": "normal",
        "lineHeight": "1.2",
        "letterSpacing": "0",
        "textTransform": "none",
    },
    "Type Label": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "600",
        "fontSize": "16",
        "fontWeight": "600",
        "fontStyle": "normal",
        "lineHeight": "1.2",
        "letterSpacing": "0",
        "textTransform": "uppercase",
    },
    "Rules Text": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "regular",
        "fontSize": "14",
        "fontWeight": "400",
        "fontStyle": "normal",
        "lineHeight": "1.4",
        "letterSpacing": "0",
        "textTransform": "none",
    },
    "Flavor Text": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "italic",
        "fontSize": "12",
        "fontWeight": "400",
        "fontStyle": "normal",
        "lineHeight": "1.3",
        "letterSpacing": "0",
        "textTransform": "none",
    },
    "Keywords": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "regular",
        "fontSize": "12",
        "fontWeight": "400",
        "fontStyle": "normal",
        "lineHeight": "1.2",
        "letterSpacing": "0",
        "textTransform": "none",
    },
    "Stat Label": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "600",
        "fontSize": "11",
        "fontWeight": "600",
        "fontStyle": "normal",
        "lineHeight": "1.2",
        "letterSpacing": "0",
        "textTransform": "uppercase",
    },
    "Stat Value": {
        "fontFamily": "sourcesanspro",
        "fontId": "gfont-source-sans-pro",
        "fontVariantId": "700",
        "fontSize": "24",
        "fontWeight": "700",
        "fontStyle": "normal",
        "lineHeight": "1.2",
        "letterSpacing": "0",
        "textTransform": "none",
    },
}

# -- Design Tokens --
TOKENS = {
    # Colors
    "color.bg.card":           {"type": "color", "value": "#1a1a2e", "description": "Card background"},
    "color.bg.inner":          {"type": "color", "value": "#2d2d44", "description": "Inner border fill"},
    "color.bg.text-area":      {"type": "color", "value": "#252540", "description": "Text area background"},
    "color.bg.art":            {"type": "color", "value": "#4a4a6a", "description": "Art placeholder"},
    "color.stat.strength":     {"type": "color", "value": "#dc2626", "description": "Strength stat box"},
    "color.stat.cunning":      {"type": "color", "value": "#2563eb", "description": "Cunning stat box"},
    "color.stat.charisma":     {"type": "color", "value": "#16a34a", "description": "Charisma stat box"},
    "color.ui.cost":           {"type": "color", "value": "#d4a843", "description": "Cost indicator"},
    "color.ui.attribute":      {"type": "color", "value": "#3b82f6", "description": "Attribute circle"},
    "color.text.primary":      {"type": "color", "value": "#ffffff", "description": "Primary text"},
    "color.text.secondary":    {"type": "color", "value": "#ccccdd", "description": "Secondary text"},
    "color.text.flavor":       {"type": "color", "value": "#9999bb", "description": "Flavor text"},
    "color.text.cost":         {"type": "color", "value": "#000000", "description": "Cost number"},
    "color.stroke.border":     {"type": "color", "value": "#3d3d5c", "description": "Border stroke"},
    "color.stroke.art":        {"type": "color", "value": "#5a5a7a", "description": "Art area stroke"},

    # Dimensions
    "size.card.width":         {"type": "dimensions", "value": "750", "description": "Card width in px"},
    "size.card.height":        {"type": "dimensions", "value": "1050", "description": "Card height in px"},
    "size.stat-box.width":     {"type": "dimensions", "value": "200", "description": "Stat box width"},
    "size.stat-box.height":    {"type": "dimensions", "value": "50", "description": "Stat box height"},
    "size.art.width":          {"type": "dimensions", "value": "630", "description": "Art area width"},
    "size.art.height":         {"type": "dimensions", "value": "380", "description": "Art area height"},

    # Spacing
    "spacing.card.margin":     {"type": "spacing", "value": "20", "description": "Card inner margin"},
    "spacing.card.padding":    {"type": "spacing", "value": "60", "description": "Content left padding"},

    # Border radius
    "radius.card":             {"type": "border-radius", "value": "16", "description": "Card corner radius"},
    "radius.small":            {"type": "border-radius", "value": "4", "description": "Small element radius"},

    # Stroke width
    "stroke.border":           {"type": "stroke-width", "value": "2", "description": "Border stroke width"},
    "stroke.art":              {"type": "stroke-width", "value": "1", "description": "Art area stroke width"},
}

# -- Shape → Token mappings --
# Maps shape IDs to which tokens apply to them
SHAPE_TOKEN_MAP = {
    # Card Background
    "63ba717e-8be2-430d-b92f-d4d110fb4221": {
        "fill": "color.bg.card",
        "r1": "radius.card",
    },
    # Inner Border
    "b99006ca-f6fb-4d12-8a7e-2f8f61be5540": {
        "fill": "color.bg.inner",
        "stroke-color": "color.stroke.border",
        "stroke-width": "stroke.border",
    },
    # Text Area
    "a3be68fa-f65d-4f3c-8914-31832c110766": {
        "fill": "color.bg.text-area",
    },
    # Card Art Placeholder
    "9fc26cad-ea85-4dd8-8e36-c93204d79720": {
        "fill": "color.bg.art",
        "stroke-color": "color.stroke.art",
        "stroke-width": "stroke.art",
    },
    # Strength Box
    "254f3a4d-3287-46a5-b142-35c492667017": {
        "fill": "color.stat.strength",
        "r1": "radius.small",
    },
    # Cunning Box
    "c25c8e5a-9328-4f0d-95bd-51615a00f7b6": {
        "fill": "color.stat.cunning",
        "r1": "radius.small",
    },
    # Charisma Box
    "700d9964-250d-4f22-9024-1542f7063571": {
        "fill": "color.stat.charisma",
        "r1": "radius.small",
    },
    # Cost Box
    "d6baa5c2-0066-4c94-8346-afbdfad00c4c": {
        "fill": "color.ui.cost",
        "r1": "radius.small",
    },
    # Attribute Circle
    "16103de8-9c21-4dd8-8d5d-e34a02ced93b": {
        "fill": "color.ui.attribute",
    },
    # Type Banner
    "0016e878-4623-4c12-901c-e4cf749fccae": {
        "fill": "color.bg.card",
    },
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Login
    print("Logging in...")
    api_post("login-with-password", {"email": EMAIL, "password": PASSWORD})

    # Get current revision
    file_data = api_post("get-file", {"id": FILE_ID, "features": FEATURES})
    revn = file_data["revn"]
    vern = file_data.get("vern", 0)
    print(f"File at revn={revn}")

    changes = []
    ts = now_iso()

    # -- Add library colors --
    print(f"Adding {len(COLORS)} library colors...")
    color_ids = {}
    for path_name, props in COLORS.items():
        cid = uid()
        path, name = path_name.rsplit("/", 1)
        color_ids[path_name] = cid
        changes.append({
            "type": "add-color",
            "color": {
                "id": cid,
                "name": name,
                "path": path,
                "color": props["color"],
                "opacity": props["opacity"],
            },
        })

    # -- Add typographies --
    print(f"Adding {len(TYPOGRAPHIES)} typographies...")
    typo_ids = {}
    for name, props in TYPOGRAPHIES.items():
        tid = uid()
        typo_ids[name] = tid
        changes.append({
            "type": "add-typography",
            "typography": {
                "id": tid,
                "name": name,
                "path": "",
                "font-family": props["fontFamily"],
                "font-id": props["fontId"],
                "font-variant-id": props["fontVariantId"],
                "font-size": props["fontSize"],
                "font-weight": props["fontWeight"],
                "font-style": props["fontStyle"],
                "line-height": props["lineHeight"],
                "letter-spacing": props["letterSpacing"],
                "text-transform": props["textTransform"],
            },
        })

    # -- Apply tokens to shapes --
    print(f"Applying tokens to {len(SHAPE_TOKEN_MAP)} shapes...")
    for shape_id, token_map in SHAPE_TOKEN_MAP.items():
        applied = {}
        for attr, token_name in token_map.items():
            applied[attr] = token_name
        changes.append({
            "type": "mod-obj",
            "page-id": PAGE_ID,
            "id": shape_id,
            "operations": [
                {"type": "set", "attr": "applied-tokens", "val": applied},
            ],
        })

    # -- Register card frame as a component --
    print("Registering Unit Card as component...")
    changes.append({
        "type": "add-component",
        "id": CARD_FRAME_ID,
        "name": "Unit Card",
        "main-instance-id": CARD_FRAME_ID,
        "main-instance-page": PAGE_ID,
        "path": "",
    })

    # -- Send all changes --
    print(f"Sending {len(changes)} changes...")
    resp = api_post("update-file", {
        "id": FILE_ID,
        "session-id": uid(),
        "revn": revn,
        "vern": vern,
        "changes": changes,
    })
    new_revn = resp.get("revn", "?")
    print(f"Done! New revn={new_revn}")

    # -- Add design tokens via separate update --
    # Tokens are stored in the file's tokensLib via W3C DTCG format.
    # IMPORTANT: tokens-lib must be a JSON *string*, not an object.
    # Penpot's JSON middleware uses read-kebab-key which strips "$" from keys,
    # but read-multi-set-dtcg re-parses strings with identity key-fn,
    # preserving "$type"/"$value" as required by the DTCG schema.
    print(f"\nAdding {len(TOKENS)} design tokens...")
    file_data2 = api_post("get-file", {"id": FILE_ID, "features": FEATURES})
    revn2 = file_data2["revn"]
    vern2 = file_data2.get("vern", 0)

    # Build DTCG nested structure: "color.bg.card" → {"color": {"bg": {"card": {...}}}}
    dtcg_sets = {"core": {}}
    for dotted_name, props in TOKENS.items():
        parts = dotted_name.split(".")
        node = dtcg_sets["core"]
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = {
            "$type": props["type"],
            "$value": props["value"],
            "$description": props.get("description", ""),
        }

    # Add themes at the top level (DTCG format)
    dtcg_sets["$themes"] = [{
        "name": "Default",
        "description": "Default card theme",
        "selectedTokenSets": {"core": "enabled"},
    }]

    # Pass as JSON string to bypass read-kebab-key "$" stripping
    token_changes = [{
        "type": "set-tokens-lib",
        "tokens-lib": json.dumps(dtcg_sets),
    }]

    resp2 = api_post("update-file", {
        "id": FILE_ID,
        "session-id": uid(),
        "revn": revn2,
        "vern": vern2,
        "changes": token_changes,
    })
    print(f"Tokens added! New revn={resp2.get('revn', '?')}")

    # -- Summary --
    print("\n" + "=" * 60)
    print("Design system setup complete!")
    print(f"  Colors:       {len(COLORS)}")
    print(f"  Typographies: {len(TYPOGRAPHIES)}")
    print(f"  Tokens:       {len(TOKENS)}")
    print(f"  Components:   1 (Unit Card)")
    print(f"  Token maps:   {len(SHAPE_TOKEN_MAP)} shapes")
    print("=" * 60)


if __name__ == "__main__":
    main()
