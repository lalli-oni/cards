#!/usr/bin/env python3
"""
Improve the Unit Card template layout in Penpot.

Fixes:
- Move stat boxes up to eliminate dead space
- Widen type banner to full card width
- Add rarity border accent
- Add action name label above rules text
- Reposition cost value to center in box

Uses mod-obj changes to update existing shapes and add-obj for new elements.
"""

import json
import uuid
import urllib.request
import urllib.error
import http.cookiejar
import sys

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

# Existing shape IDs
SHAPES = {
    "card_frame":      "c98e8b25-99cc-4912-9e34-cbda71eba131",
    "card_bg":         "63ba717e-8be2-430d-b92f-d4d110fb4221",
    "inner_border":    "b99006ca-f6fb-4d12-8a7e-2f8f61be5540",
    "attr_circle":     "16103de8-9c21-4dd8-8d5d-e34a02ced93b",
    "card_name":       "b66d9191-e4c5-43b6-890d-5dfdbd5af2ae",
    "cost_box":        "d6baa5c2-0066-4c94-8346-afbdfad00c4c",
    "cost_value":      "da6279e7-eed4-4e07-afa8-d7854ef63a6a",
    "art_placeholder": "9fc26cad-ea85-4dd8-8e36-c93204d79720",
    "type_banner":     "0016e878-4623-4c12-901c-e4cf749fccae",
    "type_label":      "9f3cdfcd-5106-448c-b1d5-218deb920b45",
    "text_area":       "a3be68fa-f65d-4f3c-8914-31832c110766",
    "rules_text":      "2dc6e411-7a12-4b67-96ed-28fc50e6b21e",
    "flavor_text":     "f7825ac8-886d-452f-9adc-9080f2df97a7",
    "keywords_bar":    "482a8f25-182a-44bd-814c-42f8177469f3",
    "keywords_text":   "3fa7768b-946f-445e-9201-052c8d68877e",
    "strength_box":    "254f3a4d-3287-46a5-b142-35c492667017",
    "strength_label":  "8d3224b2-371f-457f-aeb6-f39834566a1a",
    "strength_value":  "2012b2b9-9883-4ebf-9d63-412ce1461a8a",
    "cunning_box":     "c25c8e5a-9328-4f0d-95bd-51615a00f7b6",
    "cunning_label":   "8b588c95-aa00-4e38-a86e-b3298427675a",
    "cunning_value":   "97f7ec84-7bee-486a-bb51-4f068253d808",
    "charisma_box":    "700d9964-250d-4f22-9024-1542f7063571",
    "charisma_label":  "3f86377c-7161-422f-a1ef-5a30455cf1b7",
    "charisma_value":  "5f7d8fa7-b836-401c-86a5-7d2d9b73995a",
}

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


# ---------------------------------------------------------------------------
# Change helpers
# ---------------------------------------------------------------------------

def _transform():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def _selrect(x, y, w, h):
    x, y, w, h = int(x), int(y), int(w), int(h)
    return {"x": x, "y": y, "width": w, "height": h,
            "x1": x, "y1": y, "x2": x + w, "y2": y + h}


def _points(x, y, w, h):
    x, y, w, h = int(x), int(y), int(w), int(h)
    return [{"x": x, "y": y}, {"x": x + w, "y": y},
            {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]


def move_shape(shape_id, x, y, w, h, objects):
    """Delete and re-add a shape at a new position.

    mod-obj can't update selrect (Penpot requires a Rect record, not a plain map).
    Delete + add-obj with the same ID bypasses this — add-obj runs the JSON decoder
    which converts the map to a Rect record.

    Returns a list of changes (del-obj + add-obj).
    """
    shape = objects[shape_id]
    new_obj = dict(shape)
    new_obj.update({
        "x": x, "y": y, "width": w, "height": h,
        "selrect": _selrect(x, y, w, h),
        "points": _points(x, y, w, h),
    })
    # Clear position-data for text shapes
    if shape.get("type") == "text":
        new_obj["position-data"] = None

    return [
        {"type": "del-obj", "page-id": PAGE_ID, "id": shape_id},
        {"type": "add-obj", "page-id": PAGE_ID,
         "parent-id": CARD_FRAME_ID, "frame-id": CARD_FRAME_ID,
         "id": shape_id, "obj": new_obj},
    ]


def set_fills(shape_id, fills):
    """Change fills on a shape."""
    return {
        "type": "mod-obj",
        "page-id": PAGE_ID,
        "id": shape_id,
        "operations": [
            {"type": "set", "attr": "fills", "val": fills},
        ],
    }


def set_strokes(shape_id, strokes):
    """Change strokes on a shape."""
    return {
        "type": "mod-obj",
        "page-id": PAGE_ID,
        "id": shape_id,
        "operations": [
            {"type": "set", "attr": "strokes", "val": strokes},
        ],
    }


def set_radius(shape_id, r1, r2, r3, r4):
    """Set corner radii."""
    return {
        "type": "mod-obj",
        "page-id": PAGE_ID,
        "id": shape_id,
        "operations": [
            {"type": "set", "attr": "r1", "val": r1},
            {"type": "set", "attr": "r2", "val": r2},
            {"type": "set", "attr": "r3", "val": r3},
            {"type": "set", "attr": "r4", "val": r4},
        ],
    }


def add_rect(name, x, y, w, h, fills, strokes=None,
             r1=None, r2=None, r3=None, r4=None):
    """Add a new rect shape."""
    sid = uid()
    obj = {
        "id": sid,
        "type": "rect",
        "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": _selrect(x, y, w, h),
        "points": _points(x, y, w, h),
        "transform": _transform(),
        "transform-inverse": _transform(),
        "parent-id": CARD_FRAME_ID,
        "frame-id": CARD_FRAME_ID,
        "fills": fills,
        "strokes": strokes or [],
    }
    if r1 is not None:
        obj.update({"r1": r1, "r2": r2, "r3": r3, "r4": r4})
    change = {
        "type": "add-obj",
        "page-id": PAGE_ID,
        "parent-id": CARD_FRAME_ID,
        "frame-id": CARD_FRAME_ID,
        "id": sid,
        "obj": obj,
    }
    return sid, change


def add_text(name, x, y, w, h, text, font_size="14", font_weight="400",
             fill_color="#ffffff", fill_opacity=1, font_style=None,
             text_align=None):
    """Add a new text shape."""
    sid = uid()
    text_attrs = {
        "text": text,
        "font-family": "sourcesanspro",
        "font-id": "gfont-source-sans-pro",
        "font-size": str(font_size),
        "font-weight": str(font_weight),
        "fill-color": fill_color,
        "fill-opacity": fill_opacity,
    }
    if font_style:
        text_attrs["font-style"] = font_style
    if text_align:
        text_attrs["text-align"] = text_align

    content = {
        "type": "root",
        "children": [{
            "type": "paragraph-set",
            "children": [{
                "type": "paragraph",
                "children": [text_attrs],
            }],
        }],
    }
    obj = {
        "id": sid,
        "type": "text",
        "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": _selrect(x, y, w, h),
        "points": _points(x, y, w, h),
        "transform": _transform(),
        "transform-inverse": _transform(),
        "parent-id": CARD_FRAME_ID,
        "frame-id": CARD_FRAME_ID,
        "fills": [],
        "strokes": [],
        "content": content,
    }
    change = {
        "type": "add-obj",
        "page-id": PAGE_ID,
        "parent-id": CARD_FRAME_ID,
        "frame-id": CARD_FRAME_ID,
        "id": sid,
        "obj": obj,
    }
    return sid, change


# ---------------------------------------------------------------------------
# Layout constants — revised positions
# ---------------------------------------------------------------------------
# Card: 750 x 1050, 20px margin, content at x=60
#
# Layout (bottom-up calculation to eliminate dead space):
#   Rarity bar:   y=1020, h=6     (accent at very bottom)
#   Stats:        y=955,  h=55    (3 stat boxes side by side)
#   Keywords:     y=915,  h=30
#   Text area:    y=720,  h=185   (action name + rules + flavor)
#   Type banner:  y=685,  h=28
#   Art:          y=85,   h=590   (expanded from 380 to fill gap!)
#   Header:       y=30,   h=45    (name, cost, attribute)

STAT_Y = 955
STAT_H = 55
STAT_GAP = 10
STAT_W = 200

ART_Y = 85
ART_H = 590     # was 380 — much bigger art area

TYPE_Y = 685
TYPE_H = 28

TEXT_Y = 720
TEXT_H = 185

RULES_Y = 752   # below action name
FLAVOR_Y = 855

KW_Y = 915
KW_H = 30


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Logging in...")
    api_post("login-with-password", {"email": EMAIL, "password": PASSWORD})

    file_data = api_post("get-file", {"id": FILE_ID, "features": FEATURES})
    revn = file_data["revn"]
    vern = file_data.get("vern", 0)
    print(f"File at revn={revn}")

    # Get all current shape objects for delete+re-add
    page = file_data["data"]["pagesIndex"][PAGE_ID]
    objects = page["objects"]

    changes = []

    # ---- 1. Expand art area ----
    print("Expanding art area...")
    changes.extend(move_shape(SHAPES["art_placeholder"], 60, ART_Y, 630, ART_H, objects))
    changes.append(set_radius(SHAPES["art_placeholder"], 4, 4, 4, 4))

    # ---- 2. Move type banner down ----
    print("Repositioning type banner...")
    changes.extend(move_shape(SHAPES["type_banner"], 60, TYPE_Y, 630, TYPE_H, objects))
    changes.extend(move_shape(SHAPES["type_label"], 60, TYPE_Y, 630, TYPE_H, objects))

    # ---- 3. Move and expand text area ----
    print("Repositioning text area...")
    changes.extend(move_shape(SHAPES["text_area"], 60, TEXT_Y, 630, TEXT_H, objects))
    changes.append(set_radius(SHAPES["text_area"], 4, 4, 4, 4))

    # Rules text (below action name)
    changes.extend(move_shape(SHAPES["rules_text"], 75, RULES_Y, 600, 80, objects))
    # Flavor text
    changes.extend(move_shape(SHAPES["flavor_text"], 75, FLAVOR_Y, 600, 40, objects))

    # ---- 4. Move keywords bar ----
    print("Repositioning keywords bar...")
    changes.extend(move_shape(SHAPES["keywords_bar"], 60, KW_Y, 630, KW_H, objects))
    changes.extend(move_shape(SHAPES["keywords_text"], 70, KW_Y, 610, KW_H, objects))

    # ---- 5. Reposition stat boxes ----
    print("Repositioning stat boxes...")
    stat_x = [60, 60 + STAT_W + STAT_GAP, 60 + 2 * (STAT_W + STAT_GAP)]

    for i, (box, label, value) in enumerate([
        ("strength_box", "strength_label", "strength_value"),
        ("cunning_box", "cunning_label", "cunning_value"),
        ("charisma_box", "charisma_label", "charisma_value"),
    ]):
        changes.extend(move_shape(SHAPES[box], stat_x[i], STAT_Y, STAT_W, STAT_H, objects))
        changes.extend(move_shape(SHAPES[label], stat_x[i] + 10, STAT_Y + 5, 100, 18, objects))
        changes.extend(move_shape(SHAPES[value], stat_x[i] + STAT_W - 55, STAT_Y + 5, 50, 45, objects))
        changes.append(set_radius(SHAPES[box], 8, 8, 8, 8))

    # ---- 6. Delete old action names / rarity bars, add fresh ones ----
    print("Adding action name label...")
    # Delete any existing action names and rarity bars
    for oid, obj in objects.items():
        if obj.get("name") in ("Action Name", "Rarity Bar"):
            changes.append({"type": "del-obj", "page-id": PAGE_ID, "id": oid})

    action_id, action_change = add_text(
        "Action Name", 75, TEXT_Y + 8, 600, 22,
        "CONQUER", font_size="13", font_weight="700",
        fill_color="#d4a843",
    )
    changes.append(action_change)

    print("Adding rarity accent bar...")
    rarity_id, rarity_change = add_rect(
        "Rarity Bar", 60, 1020, 630, 6,
        fills=[{"fill-color": "#d4a843", "fill-opacity": 1}],
        r1=3, r2=3, r3=3, r4=3,
    )
    changes.append(rarity_change)

    # ---- 7. Visual refinements ----
    print("Applying visual refinements...")
    # Round inner border corners
    changes.append(set_radius(SHAPES["inner_border"], 12, 12, 12, 12))
    # Improve cost box
    changes.extend(move_shape(SHAPES["cost_box"], 668, 26, 54, 40, objects))
    changes.append(set_radius(SHAPES["cost_box"], 8, 8, 8, 8))
    changes.extend(move_shape(SHAPES["cost_value"], 668, 26, 54, 40, objects))
    # Adjust attribute circle
    changes.extend(move_shape(SHAPES["attr_circle"], 48, 33, 34, 34, objects))

    # ---- Send changes ----
    print(f"Sending {len(changes)} changes...")
    resp = api_post("update-file", {
        "id": FILE_ID,
        "session-id": uid(),
        "revn": revn,
        "vern": vern,
        "changes": changes,
    })
    print(f"Done! New revn={resp.get('revn', '?')}")

    print(f"\nNew shape IDs:")
    print(f"  action_name: {action_id}")
    print(f"  rarity_bar:  {rarity_id}")


if __name__ == "__main__":
    main()
