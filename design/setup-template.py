#!/usr/bin/env python3
"""Create the complete unit card template in Penpot (idempotent).

Reads all layout/color/typography values from tokens.json and uses the
shared penpot.py module. Running this script multiple times produces the
same result — existing shapes are deleted by name before recreation.

Usage:
    python setup-template.py [--file-id FILE_ID] [--page-id PAGE_ID]
"""

import argparse
import json
import os
import sys

from penpot import (
    PenpotClient, new_uuid,
    make_rect, make_circle, make_text, make_frame,
    del_obj_change,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_tokens() -> dict:
    path = os.path.join(SCRIPT_DIR, "tokens.json")
    with open(path) as f:
        return json.load(f)


# Names of every shape the template creates (used for idempotent cleanup)
ALL_SHAPE_NAMES = {
    "Card Background", "Inner Border", "Art Placeholder",
    "Type Circle", "Type Initial", "Card Name",
    "Cost Circle", "Cost Value",
    "Type Banner", "Type Label",
    "Text Area", "Action Name", "Rules Text",
    "Flavor Divider", "Flavor Text",
    "Strength Box", "Strength Label", "Strength Value",
    "Cunning Box", "Cunning Label", "Cunning Value",
    "Charisma Box", "Charisma Label", "Charisma Value",
    "Action Cost Box", "Action Cost Label", "Action Cost Value",
    "Rarity Bar",
}


def cleanup_existing_shapes(objects, page_id) -> list:
    """Delete all shapes inside the card frame by name. Makes the script idempotent."""
    changes = []
    for oid, obj in objects.items():
        if obj.get("name") in ALL_SHAPE_NAMES:
            changes.append(del_obj_change(page_id, oid))
    return changes


def build_template_shapes(tokens, page_id, frame_id) -> list:
    """Create ALL shapes in correct z-order (bottom to top).

    Shape z-order = add order — later additions render on top.
    """
    layout = tokens["layout"]
    colors = tokens["colors"]
    stats_cfg = tokens["stats"]
    typo = tokens["typography"]
    changes = []

    def _fill(color, opacity=1):
        return [{"fill-color": color, "fill-opacity": opacity}]

    def _stroke(color, width, opacity=1):
        return [{"stroke-color": color, "stroke-opacity": opacity,
                 "stroke-width": width, "stroke-alignment": "center",
                 "stroke-style": "solid"}]

    # 1. Card Background
    bg = layout["cardBackground"]
    _, c = make_rect("Card Background", bg["x"], bg["y"], bg["w"], bg["h"],
                     _fill(colors["background"]), page_id, frame_id, frame_id,
                     r1=bg["r"], r2=bg["r"], r3=bg["r"], r4=bg["r"])
    changes.append(c)

    # 2. Inner Border
    ib = layout["innerBorder"]
    _, c = make_rect("Inner Border", ib["x"], ib["y"], ib["w"], ib["h"],
                     _fill(colors["innerBorder"]), page_id, frame_id, frame_id,
                     strokes=_stroke(colors["borderStroke"], ib["strokeWidth"]))
    changes.append(c)

    # 3. Art Placeholder
    art = layout["artPlaceholder"]
    _, c = make_rect("Art Placeholder", art["x"], art["y"], art["w"], art["h"],
                     _fill(colors["artPlaceholder"]), page_id, frame_id, frame_id,
                     strokes=_stroke(colors["artStroke"], art["strokeWidth"]))
    changes.append(c)

    # 4. Type Circle + Initial
    tc = layout["typeCircle"]
    _, c = make_circle("Type Circle", tc["x"], tc["y"], tc["w"], tc["h"],
                       _fill(colors["attributeCircle"]), page_id, frame_id, frame_id)
    changes.append(c)

    ti_role = typo["roles"]["typeInitial"]
    _, c = make_text("Type Initial", tc["x"], tc["y"], tc["w"], tc["h"],
                     "W", page_id, frame_id, frame_id,
                     font_size=ti_role["size"], font_weight=ti_role["weight"],
                     text_align=ti_role.get("align"))
    changes.append(c)

    # 5. Card Name
    cn = layout["cardName"]
    ct_role = typo["roles"]["cardTitle"]
    _, c = make_text("Card Name", cn["x"], cn["y"], cn["w"], cn["h"],
                     "Unit Name", page_id, frame_id, frame_id,
                     font_size=ct_role["size"], font_weight=ct_role["weight"])
    changes.append(c)

    # 6. Cost Circle + Value
    cc = layout["costCircle"]
    _, c = make_circle("Cost Circle", cc["x"], cc["y"], cc["w"], cc["h"],
                       _fill(colors["costBox"]), page_id, frame_id, frame_id)
    changes.append(c)

    cv_role = typo["roles"]["costValue"]
    _, c = make_text("Cost Value", cc["x"], cc["y"], cc["w"], cc["h"],
                     "5", page_id, frame_id, frame_id,
                     font_size=cv_role["size"], font_weight=cv_role["weight"],
                     fill_color=colors["textCost"], text_align=cv_role.get("align"))
    changes.append(c)

    # 7. Type Banner + Label
    tb = layout["typeBanner"]
    _, c = make_rect("Type Banner", tb["x"], tb["y"], tb["w"], tb["h"],
                     _fill(colors["typeBanner"]), page_id, frame_id, frame_id)
    changes.append(c)

    tl_role = typo["roles"]["typeLabel"]
    _, c = make_text("Type Label", tb["x"], tb["y"], tb["w"], tb["h"],
                     "WARRIOR", page_id, frame_id, frame_id,
                     font_size=tl_role["size"], font_weight=tl_role["weight"])
    changes.append(c)

    # 8. Text Area
    ta = layout["textArea"]
    _, c = make_rect("Text Area", ta["x"], ta["y"], ta["w"], ta["h"],
                     _fill(colors["textArea"]), page_id, frame_id, frame_id,
                     r1=ta["r"], r2=ta["r"], r3=ta["r"], r4=ta["r"])
    changes.append(c)

    # 9. Action Name
    an = layout["actionName"]
    an_role = typo["roles"]["actionName"]
    _, c = make_text("Action Name", an["x"], an["y"], an["w"], an["h"],
                     "CONQUER", page_id, frame_id, frame_id,
                     font_size=an_role["size"], font_weight=an_role["weight"],
                     fill_color=colors["actionName"])
    changes.append(c)

    # 10. Rules Text
    rt = layout["rulesText"]
    rt_role = typo["roles"]["rulesText"]
    _, c = make_text("Rules Text", rt["x"], rt["y"], rt["w"], rt["h"],
                     "Card ability text goes here", page_id, frame_id, frame_id,
                     font_size=rt_role["size"], font_weight=rt_role["weight"])
    changes.append(c)

    # 11. Flavor Divider
    fd = layout["flavorDivider"]
    _, c = make_rect("Flavor Divider", fd["x"], fd["y"], fd["w"], fd["h"],
                     _fill(colors["flavorDivider"], 0.6), page_id, frame_id, frame_id)
    changes.append(c)

    # 12. Flavor Text
    ft = layout["flavorText"]
    ft_role = typo["roles"]["flavorText"]
    _, c = make_text("Flavor Text", ft["x"], ft["y"], ft["w"], ft["h"],
                     '"In the vastness of space, courage is the only currency."',
                     page_id, frame_id, frame_id,
                     font_size=ft_role["size"], font_weight=ft_role["weight"],
                     fill_color=colors["textFlavor"],
                     font_style=ft_role.get("style"))
    changes.append(c)

    # 13. Stat boxes (4x: box + label + value)
    stat_layout = layout["stats"]
    stat_order = ["strength", "cunning", "charisma", "actionCost"]
    content_w = layout["contentWidth"]
    stat_gap = stat_layout["gap"]
    stat_count = len(stat_order)
    stat_w = (content_w - (stat_count - 1) * stat_gap) // stat_count

    sl_role = typo["roles"]["statLabel"]
    sv_role = typo["roles"]["statValue"]

    for i, stat_key in enumerate(stat_order):
        stat = stats_cfg[stat_key]
        sx = layout["contentX"] + i * (stat_w + stat_gap)
        sy = stat_layout["y"]
        sh = stat_layout["h"]

        # Friendly name for shapes: "Strength" / "Action Cost"
        if stat_key == "actionCost":
            shape_name = "Action Cost"
        else:
            shape_name = stat_key.capitalize()

        # Box
        _, c = make_rect(f"{shape_name} Box", sx, sy, stat_w, sh,
                         _fill(stat["color"]), page_id, frame_id, frame_id,
                         r1=stat_layout["r"], r2=stat_layout["r"],
                         r3=stat_layout["r"], r4=stat_layout["r"])
        changes.append(c)

        # Label
        _, c = make_text(f"{shape_name} Label",
                         sx, sy + stat_layout["labelOffsetY"],
                         stat_w, stat_layout["labelHeight"],
                         stat["label"], page_id, frame_id, frame_id,
                         font_size=sl_role["size"], font_weight=sl_role["weight"],
                         text_align=sl_role.get("align"))
        changes.append(c)

        # Value
        _, c = make_text(f"{shape_name} Value",
                         sx, sy + stat_layout["valueOffsetY"],
                         stat_w, stat_layout["valueHeight"],
                         "5", page_id, frame_id, frame_id,
                         font_size=sv_role["size"], font_weight=sv_role["weight"],
                         text_align=sv_role.get("align"))
        changes.append(c)

    # 14. Rarity Bar
    rb = layout["rarityBar"]
    _, c = make_rect("Rarity Bar", rb["x"], rb["y"], rb["w"], rb["h"],
                     _fill(colors["costBox"]), page_id, frame_id, frame_id,
                     r1=rb["r"], r2=rb["r"], r3=rb["r"], r4=rb["r"])
    changes.append(c)

    return changes


def build_design_tokens(tokens) -> list:
    """Build set-tokens-lib change.

    Wraps in JSON string to preserve $-prefixes — Penpot's JSON middleware
    strips $ from keys, but set-tokens-lib re-parses the string with identity
    key-fn, preserving $type/$value as required by the DTCG schema.
    """
    dtcg_sets = {"core": {}}
    for dotted_name, props in tokens["designTokens"].items():
        parts = dotted_name.split(".")
        node = dtcg_sets["core"]
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = {
            "$type": props["type"],
            "$value": props["value"],
        }

    dtcg_sets["$themes"] = [{
        "name": "Default",
        "description": "Default card theme",
        "selectedTokenSets": {"core": "enabled"},
    }]

    return [{"type": "set-tokens-lib", "tokens-lib": json.dumps(dtcg_sets)}]


def main():
    parser = argparse.ArgumentParser(description="Create unit card template in Penpot")
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

    # If no file specified, create project + file
    if not file_id:
        print("No file ID provided — creating new project and file...")
        profile = client.api_post("get-profile", {})
        team_id = profile.get("defaultTeamId")
        project = client.api_post("create-project", {
            "team-id": team_id, "name": "Card Game",
        })
        file_resp = client.api_post("create-file", {
            "project-id": project["id"], "name": "Unit Card Template",
        })
        file_id = file_resp["id"]
        print(f"  Created file: {file_id}")

    # 2. Get file for revn/vern + existing objects
    file_data = client.get_file(file_id)
    revn = file_data["revn"]
    vern = file_data.get("vern", 0)

    if not page_id:
        page_id = file_data["data"]["pages"][0]

    objects = client.get_page_objects(file_data, page_id)
    print(f"File at revn={revn}, page={page_id}")

    # Find existing card frame, or create one
    frame_id = None
    for oid, obj in objects.items():
        if obj.get("name") == "Unit Card" and obj.get("type") == "frame":
            frame_id = oid
            break

    changes = []
    if not frame_id:
        print("Creating card frame...")
        root_id = file_data["data"]["pagesIndex"][page_id].get("id", list(objects.keys())[0])
        card = tokens["card"]
        frame_id, frame_change = make_frame(
            "Unit Card", 0, 0, card["width"], card["height"],
            page_id, root_id, root_id,
        )
        changes.append(frame_change)
    else:
        # 3. Cleanup existing shapes (idempotency)
        cleanup = cleanup_existing_shapes(objects, page_id)
        if cleanup:
            print(f"Cleaning up {len(cleanup)} existing shapes...")
            changes.extend(cleanup)

    # 4. Build all template shapes
    print("Building template shapes...")
    changes.extend(build_template_shapes(tokens, page_id, frame_id))

    # 5. Send changes
    print(f"Sending {len(changes)} changes...")
    resp = client.update_file(file_id, changes, revn, vern)
    new_revn = resp.get("revn", "?")
    print(f"Template created! revn={new_revn}")

    # 6. Design tokens (separate update to get fresh revn)
    print("Setting design tokens...")
    file_data2 = client.get_file(file_id)
    token_changes = build_design_tokens(tokens)
    client.update_file(file_id, token_changes,
                       file_data2["revn"], file_data2.get("vern", 0))
    print("Design tokens set!")

    # 7. Verify: print shape name -> ID mapping
    file_data3 = client.get_file(file_id)
    objects3 = client.get_page_objects(file_data3, page_id)
    found = client.find_shapes_by_name(objects3, ALL_SHAPE_NAMES)
    print(f"\nVerified {len(found)}/{len(ALL_SHAPE_NAMES)} shapes:")
    for name in sorted(found):
        print(f"  {name}: {found[name]}")

    missing = ALL_SHAPE_NAMES - set(found)
    if missing:
        print(f"\nWARNING: missing shapes: {missing}", file=sys.stderr)
        sys.exit(1)

    print(f"\nOpen in browser: {client.base_url}/view/{file_id}?page-id={page_id}")


if __name__ == "__main__":
    main()
