#!/usr/bin/env python3
"""
Batch export test: populate the Penpot unit card template with library data
and export a PNG for each card.

Tests whether the Penpot API + export pipeline is viable for batch card rendering.
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
import http.cookiejar

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_URL = "http://localhost:9001"
API = f"{BASE_URL}/api/rpc/command"

EMAIL = "lalli.oni@gmail.com"
PASSWORD = "King-Gradation-Clique-Essential"

FILE_ID = "e2415290-ef6d-8198-8007-b6bb3c40b7e8"
PAGE_ID = "e2415290-ef6d-8198-8007-b6bb3c40b7e9"

# Object IDs from the template (discovered via penpot-mcp search_object)
OBJECT_IDS = {
    "card_frame":      "c98e8b25-99cc-4912-9e34-cbda71eba131",
    "card_name":       "b66d9191-e4c5-43b6-890d-5dfdbd5af2ae",
    "cost_value":      "da6279e7-eed4-4e07-afa8-d7854ef63a6a",
    "type_label":      "9f3cdfcd-5106-448c-b1d5-218deb920b45",
    "rules_text":      "2dc6e411-7a12-4b67-96ed-28fc50e6b21e",
    "flavor_text":     "f7825ac8-886d-452f-9adc-9080f2df97a7",
    "keywords_text":   "3fa7768b-946f-445e-9201-052c8d68877e",
    "strength_value":  "2012b2b9-9883-4ebf-9d63-412ce1461a8a",
    "cunning_value":   "97f7ec84-7bee-486a-bb51-4f068253d808",
    "charisma_value":  "5f7d8fa7-b836-401c-86a5-7d2d9b73995a",
}

UNITS_CSV = os.path.join(os.path.dirname(__file__), "..", "library", "sets", "alpha-1", "units.csv")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "exports")

FEATURES = [
    "fdata/objects-map",
    "fdata/shape-data-type",
    "fdata/path-data",
    "components/v2",
    "styles/v2",
    "design-tokens/v1",
    "variants/v1",
    "layout/grid",
    "plugins/runtime",
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
        print(f"ERROR {exc.code} from {endpoint}: {body[:300]}", file=sys.stderr)
        sys.exit(1)


def export_png(file_id, page_id, object_id, auth_token):
    """Export an object as PNG using the Penpot export API (transit+json)."""
    url = f"{BASE_URL}/api/export"

    # Step 1: Create export
    payload = json.dumps({
        "~:wait": True,
        "~:exports": [{
            "~:type": "~:png",
            "~:suffix": "",
            "~:scale": 1,
            "~:page-id": f"~u{page_id}",
            "~:file-id": f"~u{file_id}",
            "~:name": "",
            "~:object-id": f"~u{object_id}",
        }],
        "~:profile-id": f"~u{profile_id}",
        "~:cmd": "~:export-shapes",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/transit+json",
        "Accept": "application/transit+json",
        "Cookie": f"auth-token={auth_token}",
    })
    with opener.open(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    # Step 2: Download from asset URI
    uri_value = data.get("~:uri", {})
    asset_uri = uri_value.get("~#uri") if isinstance(uri_value, dict) else uri_value

    if not asset_uri:
        raise RuntimeError(f"No asset URI in export response: {data}")

    dl_req = urllib.request.Request(asset_uri, headers={
        "Cookie": f"auth-token={auth_token}",
    })
    with opener.open(dl_req) as resp:
        return resp.read()


# ---------------------------------------------------------------------------
# Text update helper
# ---------------------------------------------------------------------------

def make_text_content(text, font_size="14", font_weight="400",
                      fill_color="#ffffff", fill_opacity=1, font_style=None):
    """Build Penpot text content structure."""
    attrs = {
        "text": text,
        "font-family": "sourcesanspro",
        "font-id": "gfont-source-sans-pro",
        "font-size": str(font_size),
        "font-weight": str(font_weight),
        "fill-color": fill_color,
        "fill-opacity": fill_opacity,
    }
    if font_style:
        attrs["font-style"] = font_style
    return {
        "type": "root",
        "children": [{
            "type": "paragraph-set",
            "children": [{
                "type": "paragraph",
                "children": [attrs],
            }],
        }],
    }


def mod_text_change(page_id, object_id, content):
    """Build a mod-obj change that updates text content.

    Also clears position-data so the exporter re-computes layout from content.
    """
    return {
        "type": "mod-obj",
        "page-id": page_id,
        "id": object_id,
        "operations": [
            {"type": "set", "attr": "content", "val": content},
            {"type": "set", "attr": "position-data", "val": None},
        ],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global profile_id

    # Login
    print("Logging in...")
    login_resp = api_post("login-with-password", {
        "email": EMAIL, "password": PASSWORD,
    })
    profile_id = login_resp["id"]

    # Get auth token from cookies
    auth_token = None
    for cookie in cookie_jar:
        if cookie.name == "auth-token":
            auth_token = cookie.value
            break
    if not auth_token:
        print("ERROR: no auth-token cookie after login", file=sys.stderr)
        sys.exit(1)

    # Get current file revision
    print("Fetching file revision...")
    file_data = api_post("get-file", {"id": FILE_ID, "features": FEATURES})
    revn = file_data.get("revn", 0)
    vern = file_data.get("vern", 0)
    print(f"  revn={revn}, vern={vern}")

    # Read card data
    with open(UNITS_CSV, newline="") as f:
        cards = list(csv.DictReader(f))
    print(f"Loaded {len(cards)} unit cards from CSV")

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Process each card
    import uuid
    session_id = str(uuid.uuid4())
    total_time = 0

    for i, card in enumerate(cards):
        t0 = time.time()
        card_id = card["id"]
        print(f"\n[{i+1}/{len(cards)}] {card['name']} ({card_id})")

        # Build attribute string from semicolon-separated values
        attributes = card.get("attributes", "").replace(";", " \u2022 ")

        # Build text update changes
        changes = [
            mod_text_change(PAGE_ID, OBJECT_IDS["card_name"],
                make_text_content(card["name"], "28", "700")),
            mod_text_change(PAGE_ID, OBJECT_IDS["cost_value"],
                make_text_content(card["cost"], "22", "700", "#000000")),
            mod_text_change(PAGE_ID, OBJECT_IDS["type_label"],
                make_text_content(attributes.upper(), "16", "600")),
            mod_text_change(PAGE_ID, OBJECT_IDS["rules_text"],
                make_text_content(card["text"], "14", "400")),
            mod_text_change(PAGE_ID, OBJECT_IDS["flavor_text"],
                make_text_content(
                    f'"{card["flavor"]}"', "12", "400",
                    "#9999bb", 1, "italic")),
            mod_text_change(PAGE_ID, OBJECT_IDS["keywords_text"],
                make_text_content(
                    card.get("keywords", "") or "\u2014", "12", "400", "#ccccdd")),
            mod_text_change(PAGE_ID, OBJECT_IDS["strength_value"],
                make_text_content(card["strength"], "24", "700")),
            mod_text_change(PAGE_ID, OBJECT_IDS["cunning_value"],
                make_text_content(card["cunning"], "24", "700")),
            mod_text_change(PAGE_ID, OBJECT_IDS["charisma_value"],
                make_text_content(card["charisma"], "24", "700")),
        ]

        # Update the file
        api_post("update-file", {
            "id": FILE_ID,
            "session-id": session_id,
            "revn": revn,
            "vern": vern,
            "changes": changes,
        })
        revn += 1  # increment for next update

        # Export PNG
        print(f"  Exporting PNG...")
        png_data = export_png(FILE_ID, PAGE_ID, OBJECT_IDS["card_frame"], auth_token)

        out_path = os.path.join(OUTPUT_DIR, f"{card_id}.png")
        with open(out_path, "wb") as f:
            f.write(png_data)

        elapsed = time.time() - t0
        total_time += elapsed
        print(f"  Saved {out_path} ({len(png_data)} bytes, {elapsed:.1f}s)")

    print(f"\nDone! Exported {len(cards)} cards in {total_time:.1f}s "
          f"({total_time/len(cards):.1f}s per card)")


if __name__ == "__main__":
    main()
