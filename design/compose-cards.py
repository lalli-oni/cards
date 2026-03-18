#!/usr/bin/env python3
"""Populate Penpot card templates with CSV data and export images.

Discovers shapes by name (zero hardcoded UUIDs), updates text/fills for
each card, exports PNG/SVG, and optionally runs postprocess-svg.py on SVGs.

Supports all 5 card types: unit, location, item, event, policy.
Auto-detects card type from CSV filename, or accepts --type override.

Usage:
    python compose-cards.py [csv_path] --format png|svg|both -o exports/
    python compose-cards.py --type location library/sets/alpha-1/locations.csv
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

# Frame and shape names per card type
FRAME_NAMES = {
    "unit": "Unit Card",
    "location": "Location Card",
    "item": "Item Card",
    "event": "Event Card",
    "policy": "Policy Card",
}

# Shapes that compose updates per card type (+ the frame for export)
UPDATABLE_SHAPES = {
    "unit": [
        "Card Name", "Cost Value", "Type Label", "Type Initial",
        "Action Name", "Rules Text", "Flavor Text",
        "Strength Value", "Cunning Value", "Charisma Value",
        "Action Cost Value", "Rarity Bar",
    ],
    "location": [
        "Card Name", "Cost Value", "Type Label", "Type Initial",
        "Mission Label", "Mission Text", "Passive Label", "Passive Text",
        "Flavor Text", "Rarity Bar",
        "Compass N Box", "Compass E Box", "Compass S Box", "Compass W Box",
    ],
    "item": [
        "Card Name", "Cost Value", "Type Label", "Type Initial",
        "Equip Label", "Equip Text", "Stored Label", "Stored Text",
        "Action Name", "Flavor Text", "Rarity Bar",
    ],
    "event": [
        "Card Name", "Cost Value", "Type Label", "Type Initial",
        "Subtype Badge", "Subtype Label",
        "Duration Label", "Duration Value",
        "Trigger Label", "Trigger Text",
        "Rules Text", "Flavor Text", "Rarity Bar",
    ],
    "policy": [
        "Card Name", "Cost Value", "Type Label", "Type Initial",
        "Effect Label", "Effect Text",
        "Flavor Text", "Rarity Bar",
    ],
}

# Required CSV columns per card type
REQUIRED_COLUMNS = {
    "unit": {"id", "name", "cost", "strength", "cunning", "charisma", "text", "flavor"},
    "location": {"id", "name", "cost", "text", "flavor"},
    "item": {"id", "name", "cost", "text", "flavor"},
    "event": {"id", "name", "cost", "subtype", "text", "flavor"},
    "policy": {"id", "name", "cost", "effect", "text", "flavor"},
}

# Map CSV filename stems to card types
FILENAME_TYPE_MAP = {
    "units": "unit",
    "locations": "location",
    "items": "item",
    "events": "event",
    "policies": "policy",
}


def load_tokens() -> dict:
    path = os.path.join(SCRIPT_DIR, "tokens.json")
    with open(path) as f:
        return json.load(f)


def detect_card_type(csv_path) -> str:
    """Detect card type from CSV filename (e.g. units.csv -> unit)."""
    stem = os.path.splitext(os.path.basename(csv_path))[0]
    card_type = FILENAME_TYPE_MAP.get(stem)
    if not card_type:
        print(f"ERROR: Cannot detect card type from filename '{stem}.csv'.", file=sys.stderr)
        print(f"  Expected one of: {', '.join(FILENAME_TYPE_MAP.keys())}", file=sys.stderr)
        print(f"  Use --type to specify manually.", file=sys.stderr)
        sys.exit(1)
    return card_type


def discover_shapes(client, file_data, page_id, card_type) -> dict:
    """Find all updatable shapes by name, scoped to the card type's frame."""
    frame_name = FRAME_NAMES[card_type]
    objects = client.get_page_objects(file_data, page_id)

    # First find the frame itself (unscoped search)
    frame_found = client.find_shapes_by_name(objects, {frame_name})
    if frame_name not in frame_found:
        print(f"ERROR: frame '{frame_name}' not found. Run setup-template.py first.", file=sys.stderr)
        sys.exit(1)
    frame_id = frame_found[frame_name]

    # Then find updatable shapes scoped to this frame
    required = set(UPDATABLE_SHAPES[card_type])
    found = client.find_shapes_by_name(objects, required, frame_id=frame_id)
    found[frame_name] = frame_id

    missing = required - set(found)
    if missing:
        print(f"ERROR: missing shapes in {card_type} template: {missing}", file=sys.stderr)
        print("Run setup-template.py first.", file=sys.stderr)
        sys.exit(1)
    return found


# ---------------------------------------------------------------------------
# Card compose functions (one per type)
# ---------------------------------------------------------------------------

def compose_unit_card(card, shape_ids, shape_geoms, tokens, page_id) -> list:
    """Build mod-obj changes for a unit card."""
    typo = tokens["typography"]["roles"]
    colors = tokens["colors"]
    mappings = tokens["mappings"]

    def _geom(name):
        return shape_geoms.get(name)

    # Parse attributes
    attr_list = card.get("attributes", "").split(";")
    attributes = " \u2022 ".join(attr_list)
    type_initial = mappings["attributeInitials"].get(attr_list[0], "?") if attr_list else "?"

    # Parse action
    actions = card.get("actions", "")
    action_parts = actions.split(":") if actions else []
    action_name = action_parts[0].upper() if action_parts else "\u2014"
    action_cost = action_parts[1] if len(action_parts) > 1 else "0"

    # Rarity color
    rarity = card.get("rarity", "common")
    rarity_color = mappings["rarityColors"].get(rarity, mappings["rarityColors"]["common"])

    return [
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


def compose_location_card(card, shape_ids, shape_geoms, tokens, page_id) -> list:
    """Build mod-obj changes for a location card."""
    typo = tokens["typography"]["roles"]
    colors = tokens["colors"]
    mappings = tokens["mappings"]

    def _geom(name):
        return shape_geoms.get(name)

    rarity = card.get("rarity", "common")
    rarity_color = mappings["rarityColors"].get(rarity, mappings["rarityColors"]["common"])

    # Parse mission (format: requirement>vp)
    mission_raw = card.get("mission", "")
    if mission_raw and ">" in mission_raw:
        req, vp = mission_raw.rsplit(">", 1)
        mission_display = f"{req.replace('_', ' ')} \u2192 {vp} VP"
    elif mission_raw:
        mission_display = mission_raw.replace("_", " ")
    else:
        mission_display = "No mission"

    # Determine mission label
    mission_label = "MISSION" if mission_raw else "\u2014"

    passive = card.get("passive", "")
    passive_label = "PASSIVE" if passive else "\u2014"
    passive_text = passive or "None"

    # Parse keywords for type label
    keywords = card.get("keywords", "")
    type_label = keywords.replace(";", " \u2022 ").upper() if keywords else "LOCATION"

    # Parse blocked edges — edges field lists BLOCKED directions
    blocked_edges = set()
    edges_raw = card.get("edges", "")
    if edges_raw:
        blocked_edges = {e.strip().upper() for e in edges_raw.split(";")}

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
            make_text_content(type_label,
                              typo["typeLabel"]["size"], typo["typeLabel"]["weight"]),
            _geom("Type Label")),
        mod_text_change(page_id, shape_ids["Type Initial"],
            make_text_content(mappings["typeInitials"]["location"],
                              typo["typeInitial"]["size"], typo["typeInitial"]["weight"],
                              text_align=typo["typeInitial"].get("align")),
            _geom("Type Initial")),
        mod_text_change(page_id, shape_ids["Mission Label"],
            make_text_content(mission_label,
                              typo["sectionLabel"]["size"], typo["sectionLabel"]["weight"],
                              fill_color=colors["sectionLabel"]),
            _geom("Mission Label")),
        mod_text_change(page_id, shape_ids["Mission Text"],
            make_text_content(mission_display,
                              typo["sectionText"]["size"], typo["sectionText"]["weight"]),
            _geom("Mission Text")),
        mod_text_change(page_id, shape_ids["Passive Label"],
            make_text_content(passive_label,
                              typo["sectionLabel"]["size"], typo["sectionLabel"]["weight"],
                              fill_color=colors["sectionLabel"]),
            _geom("Passive Label")),
        mod_text_change(page_id, shape_ids["Passive Text"],
            make_text_content(passive_text,
                              typo["sectionText"]["size"], typo["sectionText"]["weight"]),
            _geom("Passive Text")),
        mod_text_change(page_id, shape_ids["Flavor Text"],
            make_text_content(f'"{card["flavor"]}"',
                              typo["flavorText"]["size"], typo["flavorText"]["weight"],
                              fill_color=colors["textFlavor"],
                              font_style=typo["flavorText"].get("style")),
            _geom("Flavor Text")),
        mod_fills_change(page_id, shape_ids["Rarity Bar"],
            [{"fill-color": rarity_color, "fill-opacity": 1}]),
    ]

    # Compass direction boxes: open = green, blocked = dim
    for direction in ["N", "E", "S", "W"]:
        box_key = f"Compass {direction} Box"
        is_blocked = direction in blocked_edges
        box_color = colors["compassBlocked"] if is_blocked else colors["compassOpen"]
        changes.append(
            mod_fills_change(page_id, shape_ids[box_key],
                [{"fill-color": box_color, "fill-opacity": 1}]))

    return changes


def compose_item_card(card, shape_ids, shape_geoms, tokens, page_id) -> list:
    """Build mod-obj changes for an item card."""
    typo = tokens["typography"]["roles"]
    colors = tokens["colors"]
    mappings = tokens["mappings"]

    def _geom(name):
        return shape_geoms.get(name)

    rarity = card.get("rarity", "common")
    rarity_color = mappings["rarityColors"].get(rarity, mappings["rarityColors"]["common"])

    equip = card.get("equip", "")
    stored = card.get("stored", "")
    equip_label = "EQUIP" if equip else "\u2014"
    stored_label = "STORED" if stored else "\u2014"

    # Parse action
    actions = card.get("actions", "")
    action_parts = actions.split(":") if actions else []
    action_name = action_parts[0].upper() if action_parts else "\u2014"

    # Keywords for type label
    keywords = card.get("keywords", "")
    type_label = keywords.replace(";", " \u2022 ").upper() if keywords else "ITEM"

    return [
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
            make_text_content(type_label,
                              typo["typeLabel"]["size"], typo["typeLabel"]["weight"]),
            _geom("Type Label")),
        mod_text_change(page_id, shape_ids["Type Initial"],
            make_text_content(mappings["typeInitials"]["item"],
                              typo["typeInitial"]["size"], typo["typeInitial"]["weight"],
                              text_align=typo["typeInitial"].get("align")),
            _geom("Type Initial")),
        mod_text_change(page_id, shape_ids["Equip Label"],
            make_text_content(equip_label,
                              typo["sectionLabel"]["size"], typo["sectionLabel"]["weight"],
                              fill_color=colors["sectionLabel"]),
            _geom("Equip Label")),
        mod_text_change(page_id, shape_ids["Equip Text"],
            make_text_content(equip or "No equip effect",
                              typo["sectionText"]["size"], typo["sectionText"]["weight"]),
            _geom("Equip Text")),
        mod_text_change(page_id, shape_ids["Stored Label"],
            make_text_content(stored_label,
                              typo["sectionLabel"]["size"], typo["sectionLabel"]["weight"],
                              fill_color=colors["sectionLabel"]),
            _geom("Stored Label")),
        mod_text_change(page_id, shape_ids["Stored Text"],
            make_text_content(stored or "No stored effect",
                              typo["sectionText"]["size"], typo["sectionText"]["weight"]),
            _geom("Stored Text")),
        mod_text_change(page_id, shape_ids["Action Name"],
            make_text_content(action_name,
                              typo["actionName"]["size"], typo["actionName"]["weight"],
                              fill_color=colors["actionName"]),
            _geom("Action Name")),
        mod_text_change(page_id, shape_ids["Flavor Text"],
            make_text_content(f'"{card["flavor"]}"',
                              typo["flavorText"]["size"], typo["flavorText"]["weight"],
                              fill_color=colors["textFlavor"],
                              font_style=typo["flavorText"].get("style")),
            _geom("Flavor Text")),
        mod_fills_change(page_id, shape_ids["Rarity Bar"],
            [{"fill-color": rarity_color, "fill-opacity": 1}]),
    ]


def compose_event_card(card, shape_ids, shape_geoms, tokens, page_id) -> list:
    """Build mod-obj changes for an event card."""
    typo = tokens["typography"]["roles"]
    colors = tokens["colors"]
    mappings = tokens["mappings"]

    def _geom(name):
        return shape_geoms.get(name)

    rarity = card.get("rarity", "common")
    rarity_color = mappings["rarityColors"].get(rarity, mappings["rarityColors"]["common"])

    subtype = card.get("subtype", "instant")
    subtype_color = mappings["subtypeColors"].get(subtype, colors["subtypeInstant"])
    duration = card.get("duration", "")
    trigger = card.get("trigger", "")

    # Keywords for type label
    keywords = card.get("keywords", "")
    type_label = keywords.replace(";", " \u2022 ").upper() if keywords else "EVENT"

    # Duration/trigger display
    duration_label = "DURATION" if duration else "\u2014"
    duration_value = f"{duration} turns" if duration else "\u2014"
    trigger_label = "TRIGGER" if trigger else "\u2014"
    trigger_text = trigger.replace("_", " ") if trigger else "\u2014"

    return [
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
            make_text_content(type_label,
                              typo["typeLabel"]["size"], typo["typeLabel"]["weight"]),
            _geom("Type Label")),
        mod_text_change(page_id, shape_ids["Type Initial"],
            make_text_content(mappings["typeInitials"]["event"],
                              typo["typeInitial"]["size"], typo["typeInitial"]["weight"],
                              text_align=typo["typeInitial"].get("align")),
            _geom("Type Initial")),
        mod_fills_change(page_id, shape_ids["Subtype Badge"],
            [{"fill-color": subtype_color, "fill-opacity": 1}]),
        mod_text_change(page_id, shape_ids["Subtype Label"],
            make_text_content(subtype.upper(),
                              typo["subtypeLabel"]["size"], typo["subtypeLabel"]["weight"],
                              text_align=typo["subtypeLabel"].get("align")),
            _geom("Subtype Label")),
        mod_text_change(page_id, shape_ids["Duration Label"],
            make_text_content(duration_label,
                              typo["sectionLabel"]["size"], typo["sectionLabel"]["weight"],
                              fill_color=colors["sectionLabel"]),
            _geom("Duration Label")),
        mod_text_change(page_id, shape_ids["Duration Value"],
            make_text_content(duration_value,
                              typo["sectionText"]["size"], typo["sectionText"]["weight"]),
            _geom("Duration Value")),
        mod_text_change(page_id, shape_ids["Trigger Label"],
            make_text_content(trigger_label,
                              typo["sectionLabel"]["size"], typo["sectionLabel"]["weight"],
                              fill_color=colors["sectionLabel"]),
            _geom("Trigger Label")),
        mod_text_change(page_id, shape_ids["Trigger Text"],
            make_text_content(trigger_text,
                              typo["sectionText"]["size"], typo["sectionText"]["weight"]),
            _geom("Trigger Text")),
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
        mod_fills_change(page_id, shape_ids["Rarity Bar"],
            [{"fill-color": rarity_color, "fill-opacity": 1}]),
    ]


def compose_policy_card(card, shape_ids, shape_geoms, tokens, page_id) -> list:
    """Build mod-obj changes for a policy card."""
    typo = tokens["typography"]["roles"]
    colors = tokens["colors"]
    mappings = tokens["mappings"]

    def _geom(name):
        return shape_geoms.get(name)

    rarity = card.get("rarity", "common")
    rarity_color = mappings["rarityColors"].get(rarity, mappings["rarityColors"]["common"])

    # Keywords for type label
    keywords = card.get("keywords", "")
    type_label = keywords.replace(";", " \u2022 ").upper() if keywords else "POLICY"

    effect = card.get("effect", "")

    return [
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
            make_text_content(type_label,
                              typo["typeLabel"]["size"], typo["typeLabel"]["weight"]),
            _geom("Type Label")),
        mod_text_change(page_id, shape_ids["Type Initial"],
            make_text_content(mappings["typeInitials"]["policy"],
                              typo["typeInitial"]["size"], typo["typeInitial"]["weight"],
                              text_align=typo["typeInitial"].get("align")),
            _geom("Type Initial")),
        mod_text_change(page_id, shape_ids["Effect Label"],
            make_text_content("EFFECT",
                              typo["sectionLabel"]["size"], typo["sectionLabel"]["weight"],
                              fill_color=colors["sectionLabel"]),
            _geom("Effect Label")),
        mod_text_change(page_id, shape_ids["Effect Text"],
            make_text_content(effect,
                              typo["sectionText"]["size"], typo["sectionText"]["weight"]),
            _geom("Effect Text")),
        mod_text_change(page_id, shape_ids["Flavor Text"],
            make_text_content(f'"{card["flavor"]}"',
                              typo["flavorText"]["size"], typo["flavorText"]["weight"],
                              fill_color=colors["textFlavor"],
                              font_style=typo["flavorText"].get("style")),
            _geom("Flavor Text")),
        mod_fills_change(page_id, shape_ids["Rarity Bar"],
            [{"fill-color": rarity_color, "fill-opacity": 1}]),
    ]


COMPOSE_FNS = {
    "unit": compose_unit_card,
    "location": compose_location_card,
    "item": compose_item_card,
    "event": compose_event_card,
    "policy": compose_policy_card,
}


def main():
    parser = argparse.ArgumentParser(description="Compose cards from CSV and export")
    parser.add_argument("csv_path", nargs="?",
                        default=os.path.join(SCRIPT_DIR, "..", "library", "sets", "alpha-1", "units.csv"))
    parser.add_argument("--type", choices=list(FRAME_NAMES.keys()),
                        help="Card type (auto-detected from filename if omitted)")
    parser.add_argument("--format", choices=["png", "svg", "both"], default="png")
    parser.add_argument("-o", "--output", default=os.path.join(SCRIPT_DIR, "exports"))
    parser.add_argument("--file-id", default=os.environ.get("PENPOT_FILE_ID"))
    parser.add_argument("--page-id", default=os.environ.get("PENPOT_PAGE_ID"))
    args = parser.parse_args()

    # Detect card type
    card_type = args.type or detect_card_type(args.csv_path)
    print(f"Card type: {card_type}")

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
    frame_name = FRAME_NAMES[card_type]
    print(f"Discovering '{frame_name}' template shapes...")
    objects = client.get_page_objects(file_data, page_id)
    shape_ids = discover_shapes(client, file_data, page_id, card_type)
    frame_id = shape_ids[frame_name]

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

    required_cols = REQUIRED_COLUMNS[card_type]
    actual_cols = set(cards[0].keys())
    missing_cols = required_cols - actual_cols
    if missing_cols:
        print(f"ERROR: CSV missing required columns: {missing_cols}", file=sys.stderr)
        print(f"  Found columns: {sorted(actual_cols)}", file=sys.stderr)
        sys.exit(1)

    # 5. Export
    compose_fn = COMPOSE_FNS[card_type]
    os.makedirs(args.output, exist_ok=True)
    export_formats = (["png", "svg"] if args.format == "both"
                      else [args.format])

    total_time = 0
    for i, card in enumerate(cards):
        t0 = time.time()
        card_id = card["id"]
        print(f"\n[{i+1}/{len(cards)}] {card['name']} ({card_id})")

        # Compose changes
        changes = compose_fn(card, shape_ids, shape_geoms, tokens, page_id)

        # Update file
        resp = client.update_file(file_id, changes, revn, vern)
        revn = resp.get("revn", revn + 1)

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

    print(f"\nDone! Exported {len(cards)} {card_type} cards in {total_time:.1f}s "
          f"({total_time/len(cards):.1f}s per card)")


if __name__ == "__main__":
    main()
