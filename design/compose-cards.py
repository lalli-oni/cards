#!/usr/bin/env python3
"""Populate the Penpot unit card template with CSV data and export images.

Replaces: batch-export-test.py

Discovers shapes by name (zero hardcoded UUIDs), updates text/fills for
each card, exports PNG/SVG, and optionally runs postprocess-svg.py on SVGs.

Usage:
    python compose-cards.py [csv_path] --format png|svg|both -o exports/
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import time

from penpot import (
    PenpotClient, make_text_content, mod_text_change, mod_fills_change,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

UPDATABLE_SHAPES = [
    "Card Name", "Cost Value", "Type Label", "Type Initial",
    "Action Name", "Rules Text", "Flavor Text",
    "Strength Value", "Cunning Value", "Charisma Value",
    "Action Cost Value", "Rarity Bar",
]

# Also need the card frame for export
REQUIRED_SHAPES = UPDATABLE_SHAPES + ["Unit Card"]


def load_tokens() -> dict:
    path = os.path.join(SCRIPT_DIR, "tokens.json")
    with open(path) as f:
        return json.load(f)


def discover_shapes(client, file_data, page_id) -> dict:
    """Find all updatable shapes by name. Error if any missing."""
    objects = client.get_page_objects(file_data, page_id)
    found = client.find_shapes_by_name(objects, set(REQUIRED_SHAPES))
    missing = set(REQUIRED_SHAPES) - set(found)
    if missing:
        print(f"ERROR: missing shapes in template: {missing}", file=sys.stderr)
        print("Run setup-template.py first.", file=sys.stderr)
        sys.exit(1)
    return found


def compose_card(card, shape_ids, shape_geoms, tokens, page_id) -> list:
    """Build mod-obj changes for one card's data.

    shape_geoms maps shape name -> (x, y, w, h) for position-data computation.
    """
    typo = tokens["typography"]["roles"]
    colors = tokens["colors"]
    mappings = tokens["mappings"]

    def _geom(name):
        return shape_geoms.get(name)

    # Parse attributes
    attr_list = card.get("attributes", "").split(";")
    attributes = " \u2022 ".join(attr_list)
    type_initial = mappings["attributeInitials"].get(attr_list[0], "?") if attr_list else "?"

    # Parse action from actions field (format: "name:cost:effect")
    actions = card.get("actions", "")
    action_parts = actions.split(":") if actions else []
    action_name = action_parts[0].upper() if action_parts else "\u2014"
    action_cost = action_parts[1] if len(action_parts) > 1 else "0"

    # Rarity color
    rarity = card.get("rarity", "common")
    rarity_color = mappings["rarityColors"].get(rarity, mappings["rarityColors"]["common"])

    changes = [
        mod_text_change(page_id, shape_ids["Card Name"],
            make_text_content(card["name"],
                              typo["cardTitle"]["size"], typo["cardTitle"]["weight"]),
            _geom("Card Name")),
        mod_text_change(page_id, shape_ids["Cost Value"],
            make_text_content(card["cost"],
                              typo["costValue"]["size"], typo["costValue"]["weight"],
                              fill_color=colors["textCost"],
                              text_align=typo["costValue"].get("align")),
            _geom("Cost Value")),
        mod_text_change(page_id, shape_ids["Type Label"],
            make_text_content(attributes.upper(),
                              typo["typeLabel"]["size"], typo["typeLabel"]["weight"]),
            _geom("Type Label")),
        mod_text_change(page_id, shape_ids["Type Initial"],
            make_text_content(type_initial,
                              typo["typeInitial"]["size"], typo["typeInitial"]["weight"],
                              text_align=typo["typeInitial"].get("align")),
            _geom("Type Initial")),
        mod_text_change(page_id, shape_ids["Action Name"],
            make_text_content(action_name,
                              typo["actionName"]["size"], typo["actionName"]["weight"],
                              fill_color=colors["actionName"]),
            _geom("Action Name")),
        mod_text_change(page_id, shape_ids["Rules Text"],
            make_text_content(card["text"],
                              typo["rulesText"]["size"], typo["rulesText"]["weight"]),
            _geom("Rules Text")),
        mod_text_change(page_id, shape_ids["Flavor Text"],
            make_text_content(f'"{card["flavor"]}"',
                              typo["flavorText"]["size"], typo["flavorText"]["weight"],
                              fill_color=colors["textFlavor"],
                              font_style=typo["flavorText"].get("style")),
            _geom("Flavor Text")),
        mod_text_change(page_id, shape_ids["Strength Value"],
            make_text_content(card["strength"],
                              typo["statValue"]["size"], typo["statValue"]["weight"],
                              text_align=typo["statValue"].get("align")),
            _geom("Strength Value")),
        mod_text_change(page_id, shape_ids["Cunning Value"],
            make_text_content(card["cunning"],
                              typo["statValue"]["size"], typo["statValue"]["weight"],
                              text_align=typo["statValue"].get("align")),
            _geom("Cunning Value")),
        mod_text_change(page_id, shape_ids["Charisma Value"],
            make_text_content(card["charisma"],
                              typo["statValue"]["size"], typo["statValue"]["weight"],
                              text_align=typo["statValue"].get("align")),
            _geom("Charisma Value")),
        mod_text_change(page_id, shape_ids["Action Cost Value"],
            make_text_content(action_cost,
                              typo["statValue"]["size"], typo["statValue"]["weight"],
                              text_align=typo["statValue"].get("align")),
            _geom("Action Cost Value")),
        mod_fills_change(page_id, shape_ids["Rarity Bar"],
            [{"fill-color": rarity_color, "fill-opacity": 1}]),
    ]
    return changes


def main():
    parser = argparse.ArgumentParser(description="Compose cards from CSV and export")
    parser.add_argument("csv_path", nargs="?",
                        default=os.path.join(SCRIPT_DIR, "..", "library", "sets", "alpha-1", "units.csv"))
    parser.add_argument("--format", choices=["png", "svg", "both"], default="png")
    parser.add_argument("-o", "--output", default=os.path.join(SCRIPT_DIR, "exports"))
    parser.add_argument("--file-id", default=os.environ.get("PENPOT_FILE_ID"))
    parser.add_argument("--page-id", default=os.environ.get("PENPOT_PAGE_ID"))
    args = parser.parse_args()

    tokens = load_tokens()
    client = PenpotClient()

    # 1. Login
    print("Logging in...")
    client.login()

    file_id = args.file_id
    page_id = args.page_id

    # 2. Get file
    if not file_id:
        print("ERROR: --file-id or PENPOT_FILE_ID required", file=sys.stderr)
        sys.exit(1)

    file_data = client.get_file(file_id)
    revn = file_data["revn"]
    vern = file_data.get("vern", 0)

    if not page_id:
        page_id = file_data["data"]["pages"][0]

    # 3. Discover shapes by name and build geometry lookup
    print("Discovering template shapes...")
    objects = client.get_page_objects(file_data, page_id)
    shape_ids = discover_shapes(client, file_data, page_id)
    frame_id = shape_ids["Unit Card"]

    # Build name -> (x, y, w, h) for position-data in text updates
    shape_geoms = {}
    for oid, obj in objects.items():
        name = obj.get("name")
        if name in shape_ids:
            shape_geoms[name] = (obj["x"], obj["y"], obj["width"], obj["height"])

    print(f"  Found {len(shape_ids)} shapes")

    # 4. Read CSV
    with open(args.csv_path, newline="") as f:
        cards = list(csv.DictReader(f))
    print(f"Loaded {len(cards)} cards from {args.csv_path}")

    if not cards:
        print("No cards found in CSV — nothing to export.", file=sys.stderr)
        sys.exit(0)

    # 5. Export
    os.makedirs(args.output, exist_ok=True)
    export_formats = (["png", "svg"] if args.format == "both"
                      else [args.format])

    total_time = 0
    for i, card in enumerate(cards):
        t0 = time.time()
        card_id = card["id"]
        print(f"\n[{i+1}/{len(cards)}] {card['name']} ({card_id})")

        # Compose changes
        changes = compose_card(card, shape_ids, shape_geoms, tokens, page_id)

        # Update file
        client.update_file(file_id, changes, revn, vern)
        revn += 1

        # Export each format
        for fmt in export_formats:
            print(f"  Exporting {fmt.upper()}...")
            if fmt == "png":
                data = client.export_png(file_id, page_id, frame_id)
                ext = ".png"
            else:
                data = client.export_svg(file_id, page_id, frame_id)
                ext = ".svg"

            out_path = os.path.join(args.output, f"{card_id}{ext}")
            with open(out_path, "wb") as f:
                f.write(data)
            print(f"  Saved {out_path} ({len(data)} bytes)")

            # Post-process SVG
            if fmt == "svg":
                postprocess = os.path.join(SCRIPT_DIR, "postprocess-svg.py")
                if os.path.exists(postprocess):
                    subprocess.run([sys.executable, postprocess, out_path], check=True)

        elapsed = time.time() - t0
        total_time += elapsed
        print(f"  {elapsed:.1f}s")

    print(f"\nDone! Exported {len(cards)} cards in {total_time:.1f}s "
          f"({total_time/len(cards):.1f}s per card)")


if __name__ == "__main__":
    main()
