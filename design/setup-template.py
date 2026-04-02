#!/usr/bin/env python3
"""Create card templates in Penpot for all card types (idempotent).

Reads all layout/color/typography values from tokens.json and uses the
shared penpot.py module. Running this script multiple times produces the
same result — existing shapes are deleted by name before recreation.

Usage:
    python setup-template.py [--type unit|location|item|event|policy|all]
                             [--file-id FILE_ID] [--page-id PAGE_ID]
"""

import argparse
import json
import os
import sys

from penpot import (
    PenpotClient, new_uuid,
    make_rect, make_circle, make_text, make_frame, make_image,
    make_linear_gradient_fill, make_radial_gradient_fill, make_gradient_stroke,
    del_obj_change,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Frame names per card type
FRAME_NAMES = {
    "unit": "Unit Card",
    "location": "Location Card",
    "item": "Item Card",
    "event": "Event Card",
    "policy": "Policy Card",
    "card-back": "Card Back",
}

# Shape names per card type (used for idempotent cleanup)
SHARED_SHAPE_NAMES = {
    "Card Background", "Inner Border", "Art Placeholder",
    "Card Name", "Cost Circle", "Cost Value",
    "Type Circle", "Type Initial",
    "Type Banner", "Type Label",
    "Text Area", "Rarity Bar",
}

UNIT_SHAPE_NAMES = SHARED_SHAPE_NAMES | {
    "Action Name", "Rules Text",
    "Flavor Divider", "Flavor Text",
    "Strength Box", "Strength Label", "Strength Value",
    "Cunning Box", "Cunning Label", "Cunning Value",
    "Charisma Box", "Charisma Label", "Charisma Value",
    "Action Cost Box", "Action Cost Label", "Action Cost Value",
}

LOCATION_SHAPE_NAMES = SHARED_SHAPE_NAMES | {
    "Mission Label", "Mission Text",
    "Passive Label", "Passive Text",
    "Flavor Divider", "Flavor Text",
    "Compass N Box", "Compass N Label",
    "Compass E Box", "Compass E Label",
    "Compass S Box", "Compass S Label",
    "Compass W Box", "Compass W Label",
}

ITEM_SHAPE_NAMES = SHARED_SHAPE_NAMES | {
    "Equip Label", "Equip Text",
    "Stored Label", "Stored Text",
    "Action Name",
    "Flavor Divider", "Flavor Text",
}

EVENT_SHAPE_NAMES = SHARED_SHAPE_NAMES | {
    "Subtype Badge", "Subtype Label",
    "Duration Label", "Duration Value",
    "Trigger Label", "Trigger Text",
    "Rules Text",
    "Flavor Divider", "Flavor Text",
}

POLICY_SHAPE_NAMES = SHARED_SHAPE_NAMES | {
    "Effect Label", "Effect Text",
    "Flavor Divider", "Flavor Text",
}

CARD_BACK_SHAPE_NAMES = {
    "CB Background", "CB Inner Border",
    "CB Badge Shadow", "CB Badge Orb", "CB Badge Gloss",
    "CB Badge Ring", "CB Logo",
}

ALL_SHAPE_NAMES_MAP = {
    "unit": UNIT_SHAPE_NAMES,
    "location": LOCATION_SHAPE_NAMES,
    "item": ITEM_SHAPE_NAMES,
    "event": EVENT_SHAPE_NAMES,
    "policy": POLICY_SHAPE_NAMES,
    "card-back": CARD_BACK_SHAPE_NAMES,
}


def load_tokens() -> dict:
    path = os.path.join(SCRIPT_DIR, "tokens.json")
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"ERROR: tokens.json not found at {path}", file=sys.stderr)
        print("  This file defines card layout, colors, and typography.", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: tokens.json is not valid JSON: {e}", file=sys.stderr)
        sys.exit(1)


def cleanup_existing_shapes(objects, page_id, shape_names, frame_id=None) -> list:
    """Delete all shapes matching the given names within a frame.

    Belt-and-suspenders cleanup before the frame itself is deleted.
    Idempotency is achieved by the frame-level delete+recreate in setup_card_type.
    If frame_id is provided, only deletes shapes belonging to that frame.
    """
    changes = []
    for oid, obj in objects.items():
        if frame_id and obj.get("frameId", obj.get("frame-id")) != frame_id and oid != frame_id:
            continue
        if obj.get("name") in shape_names:
            changes.append(del_obj_change(page_id, oid))
    return changes


# ---------------------------------------------------------------------------
# Shared shape builders (common to all card types)
# ---------------------------------------------------------------------------

def _fill(color, opacity=1):
    return [{"fill-color": color, "fill-opacity": opacity}]


def _stroke(color, width, opacity=1):
    return [{"stroke-color": color, "stroke-opacity": opacity,
             "stroke-width": width, "stroke-alignment": "center",
             "stroke-style": "solid"}]


def build_shared_shapes(tokens, page_id, frame_id, card_type) -> list:
    """Build shapes shared across all card types."""
    layout = tokens["layout"]
    colors = tokens["colors"]
    typo = tokens["typography"]["roles"]
    mappings = tokens["mappings"]
    changes = []

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

    # Type initial: units use attribute initial, others use card type initial
    ti_role = typo["typeInitial"]
    if card_type == "unit":
        initial_text = "W"
    else:
        initial_text = mappings["typeInitials"].get(card_type, "?")
    _, c = make_text("Type Initial", tc["x"], tc["y"], tc["w"], tc["h"],
                     initial_text, page_id, frame_id, frame_id,
                     font_size=ti_role["size"], font_weight=ti_role["weight"],
                     text_align=ti_role.get("align"))
    changes.append(c)

    # 5. Card Name
    cn = layout["cardName"]
    ct_role = typo["cardTitle"]
    _, c = make_text("Card Name", cn["x"], cn["y"], cn["w"], cn["h"],
                     f"{card_type.capitalize()} Name", page_id, frame_id, frame_id,
                     font_size=ct_role["size"], font_weight=ct_role["weight"])
    changes.append(c)

    # 6. Cost Circle + Value
    cc = layout["costCircle"]
    _, c = make_circle("Cost Circle", cc["x"], cc["y"], cc["w"], cc["h"],
                       _fill(colors["costBox"]), page_id, frame_id, frame_id)
    changes.append(c)

    cv_role = typo["costValue"]
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

    tl_role = typo["typeLabel"]
    type_label = card_type.upper() if card_type != "unit" else "WARRIOR"
    _, c = make_text("Type Label", tb["x"], tb["y"], tb["w"], tb["h"],
                     type_label, page_id, frame_id, frame_id,
                     font_size=tl_role["size"], font_weight=tl_role["weight"])
    changes.append(c)

    # 8. Text Area
    ta = layout["textArea"]
    _, c = make_rect("Text Area", ta["x"], ta["y"], ta["w"], ta["h"],
                     _fill(colors["textArea"]), page_id, frame_id, frame_id,
                     r1=ta["r"], r2=ta["r"], r3=ta["r"], r4=ta["r"])
    changes.append(c)

    # 9. Rarity Bar
    rb = layout["rarityBar"]
    _, c = make_rect("Rarity Bar", rb["x"], rb["y"], rb["w"], rb["h"],
                     _fill(colors["costBox"]), page_id, frame_id, frame_id,
                     r1=rb["r"], r2=rb["r"], r3=rb["r"], r4=rb["r"])
    changes.append(c)

    return changes


# ---------------------------------------------------------------------------
# Type-specific shape builders
# ---------------------------------------------------------------------------

def build_unit_shapes(tokens, page_id, frame_id) -> list:
    """Build unit-specific shapes: action name, rules, flavor, 4x stat boxes."""
    layout = tokens["layout"]
    colors = tokens["colors"]
    stats_cfg = tokens["stats"]
    typo = tokens["typography"]["roles"]
    changes = []

    # Action Name
    an = layout["actionName"]
    an_role = typo["actionName"]
    _, c = make_text("Action Name", an["x"], an["y"], an["w"], an["h"],
                     "CONQUER", page_id, frame_id, frame_id,
                     font_size=an_role["size"], font_weight=an_role["weight"],
                     fill_color=colors["actionName"])
    changes.append(c)

    # Rules Text
    rt = layout["rulesText"]
    rt_role = typo["rulesText"]
    _, c = make_text("Rules Text", rt["x"], rt["y"], rt["w"], rt["h"],
                     "Card ability text goes here", page_id, frame_id, frame_id,
                     font_size=rt_role["size"], font_weight=rt_role["weight"])
    changes.append(c)

    # Flavor Divider
    fd = layout["flavorDivider"]
    _, c = make_rect("Flavor Divider", fd["x"], fd["y"], fd["w"], fd["h"],
                     _fill(colors["flavorDivider"], 0.6), page_id, frame_id, frame_id)
    changes.append(c)

    # Flavor Text
    ft = layout["flavorText"]
    ft_role = typo["flavorText"]
    _, c = make_text("Flavor Text", ft["x"], ft["y"], ft["w"], ft["h"],
                     '"In the vastness of space, courage is the only currency."',
                     page_id, frame_id, frame_id,
                     font_size=ft_role["size"], font_weight=ft_role["weight"],
                     fill_color=colors["textFlavor"],
                     font_style=ft_role.get("style"))
    changes.append(c)

    # Stat boxes (4x: box + label + value)
    stat_layout = layout["stats"]
    stat_order = ["strength", "cunning", "charisma", "actionCost"]
    content_w = layout["contentWidth"]
    stat_gap = stat_layout["gap"]
    stat_count = len(stat_order)
    stat_w = (content_w - (stat_count - 1) * stat_gap) // stat_count

    sl_role = typo["statLabel"]
    sv_role = typo["statValue"]

    for i, stat_key in enumerate(stat_order):
        stat = stats_cfg[stat_key]
        sx = layout["contentX"] + i * (stat_w + stat_gap)
        sy = stat_layout["y"]
        sh = stat_layout["h"]

        shape_name = "Action Cost" if stat_key == "actionCost" else stat_key.capitalize()

        _, c = make_rect(f"{shape_name} Box", sx, sy, stat_w, sh,
                         _fill(stat["color"]), page_id, frame_id, frame_id,
                         r1=stat_layout["r"], r2=stat_layout["r"],
                         r3=stat_layout["r"], r4=stat_layout["r"])
        changes.append(c)

        _, c = make_text(f"{shape_name} Label",
                         sx, sy + stat_layout["labelOffsetY"],
                         stat_w, stat_layout["labelHeight"],
                         stat["label"], page_id, frame_id, frame_id,
                         font_size=sl_role["size"], font_weight=sl_role["weight"],
                         text_align=sl_role.get("align"))
        changes.append(c)

        _, c = make_text(f"{shape_name} Value",
                         sx, sy + stat_layout["valueOffsetY"],
                         stat_w, stat_layout["valueHeight"],
                         "5", page_id, frame_id, frame_id,
                         font_size=sv_role["size"], font_weight=sv_role["weight"],
                         text_align=sv_role.get("align"))
        changes.append(c)

    return changes


def build_location_shapes(tokens, page_id, frame_id) -> list:
    """Build location-specific shapes: mission, passive, compass rose."""
    loc = tokens["locationLayout"]
    colors = tokens["colors"]
    typo = tokens["typography"]["roles"]
    changes = []

    sl_role = typo["sectionLabel"]
    st_role = typo["sectionText"]

    # Mission Label
    ml = loc["missionLabel"]
    _, c = make_text("Mission Label", ml["x"], ml["y"], ml["w"], ml["h"],
                     "MISSION", page_id, frame_id, frame_id,
                     font_size=sl_role["size"], font_weight=sl_role["weight"],
                     fill_color=colors["sectionLabel"])
    changes.append(c)

    # Mission Text
    mt = loc["missionText"]
    _, c = make_text("Mission Text", mt["x"], mt["y"], mt["w"], mt["h"],
                     "Mission requirement text", page_id, frame_id, frame_id,
                     font_size=st_role["size"], font_weight=st_role["weight"])
    changes.append(c)

    # Passive Label
    pl = loc["passiveLabel"]
    _, c = make_text("Passive Label", pl["x"], pl["y"], pl["w"], pl["h"],
                     "PASSIVE", page_id, frame_id, frame_id,
                     font_size=sl_role["size"], font_weight=sl_role["weight"],
                     fill_color=colors["sectionLabel"])
    changes.append(c)

    # Passive Text
    pt = loc["passiveText"]
    _, c = make_text("Passive Text", pt["x"], pt["y"], pt["w"], pt["h"],
                     "Passive effect text", page_id, frame_id, frame_id,
                     font_size=st_role["size"], font_weight=st_role["weight"])
    changes.append(c)

    # Flavor Divider
    fd = loc["flavorDivider"]
    _, c = make_rect("Flavor Divider", fd["x"], fd["y"], fd["w"], fd["h"],
                     _fill(colors["flavorDivider"], 0.6), page_id, frame_id, frame_id)
    changes.append(c)

    # Flavor Text
    ft = loc["flavorText"]
    ft_role = typo["flavorText"]
    _, c = make_text("Flavor Text", ft["x"], ft["y"], ft["w"], ft["h"],
                     '"Where empires were forged."',
                     page_id, frame_id, frame_id,
                     font_size=ft_role["size"], font_weight=ft_role["weight"],
                     fill_color=colors["textFlavor"],
                     font_style=ft_role.get("style"))
    changes.append(c)

    # Compass Rose: 4 direction boxes (N, E, S, W) in cross pattern
    compass = loc["compass"]
    cl_role = typo["compassLabel"]

    for direction in ["N", "E", "S", "W"]:
        d = compass[direction]
        # Default all edges to open in template
        box_color = colors["compassOpen"]

        _, c = make_rect(f"Compass {direction} Box",
                         d["x"], d["y"], d["w"], d["h"],
                         _fill(box_color), page_id, frame_id, frame_id,
                         r1=compass["r"], r2=compass["r"],
                         r3=compass["r"], r4=compass["r"])
        changes.append(c)

        _, c = make_text(f"Compass {direction} Label",
                         d["x"], d["y"], d["w"], d["h"],
                         direction, page_id, frame_id, frame_id,
                         font_size=cl_role["size"], font_weight=cl_role["weight"],
                         text_align=cl_role.get("align"))
        changes.append(c)

    return changes


def build_item_shapes(tokens, page_id, frame_id) -> list:
    """Build item-specific shapes: equip, stored, action, flavor."""
    item = tokens["itemLayout"]
    colors = tokens["colors"]
    typo = tokens["typography"]["roles"]
    changes = []

    sl_role = typo["sectionLabel"]
    st_role = typo["sectionText"]

    # Equip Label
    el = item["equipLabel"]
    _, c = make_text("Equip Label", el["x"], el["y"], el["w"], el["h"],
                     "EQUIP", page_id, frame_id, frame_id,
                     font_size=sl_role["size"], font_weight=sl_role["weight"],
                     fill_color=colors["sectionLabel"])
    changes.append(c)

    # Equip Text
    et = item["equipText"]
    _, c = make_text("Equip Text", et["x"], et["y"], et["w"], et["h"],
                     "Effect when equipped by a unit", page_id, frame_id, frame_id,
                     font_size=st_role["size"], font_weight=st_role["weight"])
    changes.append(c)

    # Stored Label
    sl = item["storedLabel"]
    _, c = make_text("Stored Label", sl["x"], sl["y"], sl["w"], sl["h"],
                     "STORED", page_id, frame_id, frame_id,
                     font_size=sl_role["size"], font_weight=sl_role["weight"],
                     fill_color=colors["sectionLabel"])
    changes.append(c)

    # Stored Text
    stt = item["storedText"]
    _, c = make_text("Stored Text", stt["x"], stt["y"], stt["w"], stt["h"],
                     "Effect when stored at a location", page_id, frame_id, frame_id,
                     font_size=st_role["size"], font_weight=st_role["weight"])
    changes.append(c)

    # Action Name
    an = item["actionName"]
    an_role = typo["actionName"]
    _, c = make_text("Action Name", an["x"], an["y"], an["w"], an["h"],
                     "USE", page_id, frame_id, frame_id,
                     font_size=an_role["size"], font_weight=an_role["weight"],
                     fill_color=colors["actionName"])
    changes.append(c)

    # Flavor Divider
    fd = item["flavorDivider"]
    _, c = make_rect("Flavor Divider", fd["x"], fd["y"], fd["w"], fd["h"],
                     _fill(colors["flavorDivider"], 0.6), page_id, frame_id, frame_id)
    changes.append(c)

    # Flavor Text
    ft = item["flavorText"]
    ft_role = typo["flavorText"]
    _, c = make_text("Flavor Text", ft["x"], ft["y"], ft["w"], ft["h"],
                     '"Every tool has its purpose."',
                     page_id, frame_id, frame_id,
                     font_size=ft_role["size"], font_weight=ft_role["weight"],
                     fill_color=colors["textFlavor"],
                     font_style=ft_role.get("style"))
    changes.append(c)

    return changes


def build_event_shapes(tokens, page_id, frame_id) -> list:
    """Build event-specific shapes: subtype badge, duration, trigger, rules, flavor."""
    evt = tokens["eventLayout"]
    colors = tokens["colors"]
    typo = tokens["typography"]["roles"]
    changes = []

    sl_role = typo["sectionLabel"]
    st_role = typo["sectionText"]

    # Subtype Badge (background rect)
    sb = evt["subtypeBadge"]
    _, c = make_rect("Subtype Badge", sb["x"], sb["y"], sb["w"], sb["h"],
                     _fill(colors["subtypeInstant"]), page_id, frame_id, frame_id,
                     r1=sb["r"], r2=sb["r"], r3=sb["r"], r4=sb["r"])
    changes.append(c)

    # Subtype Label (text on badge)
    sbl = evt["subtypeLabel"]
    sub_role = typo["subtypeLabel"]
    _, c = make_text("Subtype Label", sbl["x"], sbl["y"], sbl["w"], sbl["h"],
                     "INSTANT", page_id, frame_id, frame_id,
                     font_size=sub_role["size"], font_weight=sub_role["weight"],
                     text_align=sub_role.get("align"))
    changes.append(c)

    # Duration Label
    dl = evt["durationLabel"]
    _, c = make_text("Duration Label", dl["x"], dl["y"], dl["w"], dl["h"],
                     "DURATION", page_id, frame_id, frame_id,
                     font_size=sl_role["size"], font_weight=sl_role["weight"],
                     fill_color=colors["sectionLabel"])
    changes.append(c)

    # Duration Value
    dv = evt["durationValue"]
    _, c = make_text("Duration Value", dv["x"], dv["y"], dv["w"], dv["h"],
                     "3 turns", page_id, frame_id, frame_id,
                     font_size=st_role["size"], font_weight=st_role["weight"])
    changes.append(c)

    # Trigger Label
    tl = evt["triggerLabel"]
    _, c = make_text("Trigger Label", tl["x"], tl["y"], tl["w"], tl["h"],
                     "TRIGGER", page_id, frame_id, frame_id,
                     font_size=sl_role["size"], font_weight=sl_role["weight"],
                     fill_color=colors["sectionLabel"])
    changes.append(c)

    # Trigger Text
    tt = evt["triggerText"]
    _, c = make_text("Trigger Text", tt["x"], tt["y"], tt["w"], tt["h"],
                     "Trigger condition", page_id, frame_id, frame_id,
                     font_size=st_role["size"], font_weight=st_role["weight"])
    changes.append(c)

    # Rules Text
    rt = evt["rulesText"]
    rt_role = typo["rulesText"]
    _, c = make_text("Rules Text", rt["x"], rt["y"], rt["w"], rt["h"],
                     "Event effect text goes here", page_id, frame_id, frame_id,
                     font_size=rt_role["size"], font_weight=rt_role["weight"])
    changes.append(c)

    # Flavor Divider
    fd = evt["flavorDivider"]
    _, c = make_rect("Flavor Divider", fd["x"], fd["y"], fd["w"], fd["h"],
                     _fill(colors["flavorDivider"], 0.6), page_id, frame_id, frame_id)
    changes.append(c)

    # Flavor Text
    ft = evt["flavorText"]
    ft_role = typo["flavorText"]
    _, c = make_text("Flavor Text", ft["x"], ft["y"], ft["w"], ft["h"],
                     '"Fate strikes without warning."',
                     page_id, frame_id, frame_id,
                     font_size=ft_role["size"], font_weight=ft_role["weight"],
                     fill_color=colors["textFlavor"],
                     font_style=ft_role.get("style"))
    changes.append(c)

    return changes


def build_policy_shapes(tokens, page_id, frame_id) -> list:
    """Build policy-specific shapes: effect label, effect text, flavor."""
    pol = tokens["policyLayout"]
    colors = tokens["colors"]
    typo = tokens["typography"]["roles"]
    changes = []

    sl_role = typo["sectionLabel"]
    st_role = typo["sectionText"]

    # Effect Label
    el = pol["effectLabel"]
    _, c = make_text("Effect Label", el["x"], el["y"], el["w"], el["h"],
                     "EFFECT", page_id, frame_id, frame_id,
                     font_size=sl_role["size"], font_weight=sl_role["weight"],
                     fill_color=colors["sectionLabel"])
    changes.append(c)

    # Effect Text
    et = pol["effectText"]
    _, c = make_text("Effect Text", et["x"], et["y"], et["w"], et["h"],
                     "Global modifier text goes here", page_id, frame_id, frame_id,
                     font_size=st_role["size"], font_weight=st_role["weight"])
    changes.append(c)

    # Flavor Divider
    fd = pol["flavorDivider"]
    _, c = make_rect("Flavor Divider", fd["x"], fd["y"], fd["w"], fd["h"],
                     _fill(colors["flavorDivider"], 0.6), page_id, frame_id, frame_id)
    changes.append(c)

    # Flavor Text
    ft = pol["flavorText"]
    ft_role = typo["flavorText"]
    _, c = make_text("Flavor Text", ft["x"], ft["y"], ft["w"], ft["h"],
                     '"The pen rules where the sword cannot."',
                     page_id, frame_id, frame_id,
                     font_size=ft_role["size"], font_weight=ft_role["weight"],
                     fill_color=colors["textFlavor"],
                     font_style=ft_role.get("style"))
    changes.append(c)

    return changes


# ---------------------------------------------------------------------------
# Card back builder
# ---------------------------------------------------------------------------

# Badge gradient stops at hue=0 (red). Pre-computed from the SVG's HSL values.
_BADGE_STOPS = [
    {"color": "#DA5858", "offset": 0,    "opacity": 1},  # hsl(0, 64%, 60%)
    {"color": "#B32E2E", "offset": 0.35, "opacity": 1},  # hsl(0, 59%, 44%)
    {"color": "#791B1B", "offset": 0.70, "opacity": 1},  # hsl(0, 64%, 29%)
    {"color": "#4F1212", "offset": 0.92, "opacity": 1},  # hsl(0, 63%, 19%)
    {"color": "#661A1A", "offset": 1,    "opacity": 1},  # hsl(0, 60%, 25%)
]

_SILVER_STOPS = [
    {"color": "#e8e8f0", "offset": 0,    "opacity": 1},
    {"color": "#c8c8d8", "offset": 0.25, "opacity": 1},
    {"color": "#7878a0", "offset": 0.70, "opacity": 1},
    {"color": "#a8a8c0", "offset": 1,    "opacity": 1},
]


def build_card_back_shapes(tokens, page_id, frame_id, client=None, file_id=None):
    """Build all shapes for the card back template."""
    card = tokens["card"]
    w, h = card["width"], card["height"]
    changes = []

    # Badge geometry: circle centered at (375, 440), radius 155
    bx, by, bw, bh = 220, 285, 310, 310  # bounding box

    # 1. Background with linear gradient
    bg_fill = make_linear_gradient_fill(
        0.5, 0, 0.5, 1,
        [{"color": "#0d0d22", "offset": 0, "opacity": 1},
         {"color": "#131330", "offset": 0.5, "opacity": 1},
         {"color": "#1a1a3e", "offset": 1, "opacity": 1}],
    )
    _, c = make_rect("CB Background", 0, 0, w, h, [bg_fill],
                     page_id, frame_id, frame_id,
                     r1=16, r2=16, r3=16, r4=16)
    changes.append(c)

    # 2. Inner border
    _, c = make_rect("CB Inner Border", 20, 20, 710, 1010, [],
                     page_id, frame_id, frame_id,
                     strokes=[{"stroke-color": "#2d2d44", "stroke-opacity": 1,
                               "stroke-width": 2, "stroke-alignment": "center",
                               "stroke-style": "solid"}],
                     r1=12, r2=12, r3=12, r4=12)
    changes.append(c)

    # 3. Badge shadow (solid circle, offset down 4px)
    _, c = make_circle("CB Badge Shadow", bx, by + 4, bw, bh,
                       [{"fill-color": "#000000", "fill-opacity": 1}],
                       page_id, frame_id, frame_id, opacity=0.35)
    changes.append(c)

    # 4. Badge orb with radial gradient
    # Penpot radial: start=focal point, end=outer edge (determines radius).
    # Focal slightly upper-left; edge at bottom-right to span full circle.
    orb_fill = make_radial_gradient_fill(
        0.42, 0.34,  # start (focal point, upper-left)
        0.5, 1.0,    # end (bottom edge — radius covers full shape)
        1, _BADGE_STOPS,
    )
    _, c = make_circle("CB Badge Orb", bx, by, bw, bh, [orb_fill],
                       page_id, frame_id, frame_id)
    changes.append(c)

    # 5. Gloss overlay (white radial fade)
    gloss_fill = make_radial_gradient_fill(
        0.47, 0.28,  # focal upper-left
        0.5, 0.85,   # end toward bottom (wide spread)
        1,
        [{"color": "#ffffff", "offset": 0, "opacity": 0.40},
         {"color": "#ffffff", "offset": 0.35, "opacity": 0.08},
         {"color": "#ffffff", "offset": 1, "opacity": 0}],
    )
    _, c = make_circle("CB Badge Gloss", bx, by, bw, bh, [gloss_fill],
                       page_id, frame_id, frame_id)
    changes.append(c)

    # 6. Silver ring (gradient stroke, no fill)
    ring_stroke = make_gradient_stroke(
        "linear", 0.5, 0, 0.5, 1, _SILVER_STOPS, width=6,
    )
    _, c = make_circle("CB Badge Ring", bx, by, bw, bh, [],
                       page_id, frame_id, frame_id,
                       strokes=[ring_stroke])
    changes.append(c)

    # 7. Logo (upload styled wordmark as media image)
    if client and file_id:
        logo_path = os.path.join(SCRIPT_DIR, "logo", "cords-wordmark-styled.svg")
        if not os.path.isfile(logo_path):
            print(f"ERROR: Logo SVG not found at {logo_path}", file=sys.stderr)
            print("  Ensure the styled wordmark exists in design/logo/.", file=sys.stderr)
            sys.exit(1)
        print("  Uploading logo media...")
        media = client.upload_media(file_id, "cords-wordmark-styled", logo_path)
        media_id = media.get("id")
        if not media_id:
            print(f"ERROR: upload_media response missing 'id'. Keys: {list(media.keys())}",
                  file=sys.stderr)
            sys.exit(1)
        media_w = media.get("width")
        media_h = media.get("height")
        mtype = media.get("mtype")
        if media_w is None or media_h is None:
            print(f"  WARNING: upload response missing width/height "
                  f"(keys: {list(media.keys())}). Using defaults.", file=sys.stderr)
        _, c = make_image("CB Logo", 248, 402, 254, 82,
                          media_id, media_w or 620, media_h or 200,
                          mtype or "image/svg+xml",
                          page_id, frame_id, frame_id)
        changes.append(c)
    else:
        print("  WARNING: No client/file_id — logo will be missing from card back",
              file=sys.stderr)

    return changes


TYPE_BUILDERS = {
    "unit": build_unit_shapes,
    "location": build_location_shapes,
    "item": build_item_shapes,
    "event": build_event_shapes,
    "policy": build_policy_shapes,
}


def build_design_tokens(tokens) -> list:
    """Build set-tokens-lib change."""
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


def setup_card_type(client, file_id, page_id, tokens, card_type):
    """Set up a single card type template in the file."""
    frame_name = FRAME_NAMES[card_type]
    shape_names = ALL_SHAPE_NAMES_MAP[card_type]

    # Get current file state
    file_data = client.get_file(file_id)
    revn = file_data["revn"]
    vern = file_data.get("vern", 0)
    if "vern" not in file_data:
        print("  NOTE: File data missing 'vern' field (older Penpot version?). Using vern=0.", file=sys.stderr)

    if not page_id:
        page_id = file_data["data"]["pages"][0]

    objects = client.get_page_objects(file_data, page_id)

    # Find existing frame — delete it entirely for clean recreation
    changes = []
    root_id = file_data["data"]["pagesIndex"][page_id].get("id", list(objects.keys())[0])
    for oid, obj in objects.items():
        if obj.get("name") == frame_name and obj.get("type") == "frame":
            print(f"  Deleting existing frame '{frame_name}'...")
            # Delete children first, then the frame
            cleanup = cleanup_existing_shapes(objects, page_id, shape_names, oid)
            changes.extend(cleanup)
            changes.append(del_obj_change(page_id, oid))
            break

    # Create fresh frame at origin
    print(f"  Creating frame '{frame_name}'...")
    card = tokens["card"]
    frame_id, frame_change = make_frame(
        frame_name, 0, 0, card["width"], card["height"],
        page_id, root_id, root_id,
    )
    changes.append(frame_change)

    # Build shapes
    if card_type == "card-back":
        changes.extend(build_card_back_shapes(tokens, page_id, frame_id, client, file_id))
    else:
        changes.extend(build_shared_shapes(tokens, page_id, frame_id, card_type))
        changes.extend(TYPE_BUILDERS[card_type](tokens, page_id, frame_id))

    # Send changes
    print(f"  Sending {len(changes)} changes...")
    resp = client.update_file(file_id, changes, revn, vern)
    new_revn = resp.get("revn", "?")
    print(f"  Template '{frame_name}' created! revn={new_revn}")

    # Verify — scope to this frame only
    file_data2 = client.get_file(file_id)
    objects2 = client.get_page_objects(file_data2, page_id)
    found = client.find_shapes_by_name(objects2, shape_names, frame_id)
    print(f"  Verified {len(found)}/{len(shape_names)} shapes")

    missing = shape_names - set(found)
    if missing:
        print(f"  WARNING: missing shapes: {missing}", file=sys.stderr)
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Create card templates in Penpot")
    parser.add_argument("--type", choices=list(FRAME_NAMES.keys()) + ["all"],
                        default="all", help="Card type to create (default: all)")
    parser.add_argument("--file-id", default=os.environ.get("PENPOT_FILE_ID"))
    parser.add_argument("--page-id", default=os.environ.get("PENPOT_PAGE_ID"))
    args = parser.parse_args()

    tokens = load_tokens()
    client = PenpotClient()

    print("Logging in...")
    client.login()

    file_id = args.file_id
    page_id = args.page_id

    if not file_id:
        print("No file ID provided — creating new project and file...")
        profile = client.api_post("get-profile", {})
        team_id = profile.get("defaultTeamId")
        project = client.api_post("create-project", {
            "team-id": team_id, "name": "Card Game",
        })
        file_resp = client.api_post("create-file", {
            "project-id": project["id"], "name": "Card Templates",
        })
        file_id = file_resp["id"]
        print(f"  Created file: {file_id}")

    # Determine which types to build
    card_types = list(FRAME_NAMES.keys()) if args.type == "all" else [args.type]

    failed_types = []
    for card_type in card_types:
        print(f"\nSetting up {card_type} template...")
        if not setup_card_type(client, file_id, page_id, tokens, card_type):
            failed_types.append(card_type)

    # Design tokens (once, after all templates)
    print("\nSetting design tokens...")
    file_data = client.get_file(file_id)
    token_changes = build_design_tokens(tokens)
    resp = client.update_file(file_id, token_changes,
                              file_data["revn"], file_data.get("vern", 0))
    if "revn" not in resp:
        print("WARNING: Design tokens update response missing 'revn'.", file=sys.stderr)
    print("Design tokens set!")

    if failed_types:
        print(f"\nERROR: Templates with missing shapes: {', '.join(failed_types)}", file=sys.stderr)
        sys.exit(1)

    print(f"\nAll done! Open in browser: {client.base_url}/view/{file_id}")


if __name__ == "__main__":
    main()
