#!/usr/bin/env python3
"""
Create a Unit Card Template in Penpot via REST API.

This script authenticates with a local Penpot instance and creates a project,
file, and card template with all visual elements for a Star Trek CCG-style
unit card (750x1050px).

Usage:
    python3 create-card-template.py

Requires a running Penpot instance at localhost:9001.
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
TEAM_ID = "e2415290-ef6d-8198-8007-b6a2e391918e"

PROJECT_NAME = "Card Game"
FILE_NAME = "Unit Card Template"

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
# HTTP helpers – stdlib only (urllib + cookiejar)
# ---------------------------------------------------------------------------
cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def api_post(endpoint: str, payload: dict) -> dict:
    """POST JSON to a Penpot API endpoint and return parsed response."""
    url = f"{API}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
    )
    try:
        with opener.open(req) as resp:
            body = resp.read().decode("utf-8")
            if body:
                return json.loads(body)
            return {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"ERROR {exc.code} from {endpoint}: {body}", file=sys.stderr)
        sys.exit(1)


def new_uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Shape builder helpers
# ---------------------------------------------------------------------------

def _transform():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def _selrect(x, y, w, h):
    return {
        "x": x, "y": y, "width": w, "height": h,
        "x1": x, "y1": y, "x2": x + w, "y2": y + h,
    }


def _points(x, y, w, h):
    return [
        {"x": x, "y": y},
        {"x": x + w, "y": y},
        {"x": x + w, "y": y + h},
        {"x": x, "y": y + h},
    ]


def make_rect(
    name, x, y, w, h, fills, strokes=None,
    parent_id=None, frame_id=None,
    r1=None, r2=None, r3=None, r4=None,
):
    """Build a rect shape dict + its add-obj change entry."""
    sid = new_uuid()
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
        "parent-id": parent_id,
        "frame-id": frame_id,
        "fills": fills,
        "strokes": strokes or [],
    }
    if r1 is not None:
        obj["r1"] = r1
        obj["r2"] = r2
        obj["r3"] = r3
        obj["r4"] = r4
    return sid, obj


def make_circle(name, x, y, w, h, fills, parent_id=None, frame_id=None):
    """Build a circle shape dict."""
    sid = new_uuid()
    obj = {
        "id": sid,
        "type": "circle",
        "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": _selrect(x, y, w, h),
        "points": _points(x, y, w, h),
        "transform": _transform(),
        "transform-inverse": _transform(),
        "parent-id": parent_id,
        "frame-id": frame_id,
        "fills": fills,
        "strokes": [],
    }
    return sid, obj


def make_text(
    name, x, y, w, h, text, font_size="14", font_weight="400",
    fill_color="#ffffff", fill_opacity=1, font_style=None,
    parent_id=None, frame_id=None,
):
    """Build a text shape dict with Penpot content structure."""
    sid = new_uuid()

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
        "parent-id": parent_id,
        "frame-id": frame_id,
        "fills": [],
        "strokes": [],
        "content": content,
    }
    return sid, obj


def make_frame(name, x, y, w, h, fills=None, parent_id=None, frame_id=None):
    """Build a frame shape dict."""
    sid = new_uuid()
    obj = {
        "id": sid,
        "type": "frame",
        "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": _selrect(x, y, w, h),
        "points": _points(x, y, w, h),
        "transform": _transform(),
        "transform-inverse": _transform(),
        "parent-id": parent_id,
        "frame-id": frame_id,
        "fills": fills or [{"fill-color": "#FFFFFF", "fill-opacity": 0}],
        "strokes": [],
        "shapes": [],
    }
    return sid, obj


def add_obj_change(page_id, parent_id, frame_id, sid, obj):
    """Wrap a shape object in an add-obj change entry."""
    return {
        "type": "add-obj",
        "page-id": page_id,
        "parent-id": parent_id,
        "frame-id": frame_id,
        "id": sid,
        "obj": obj,
    }


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------

def main():
    # ---- Step 1: Login ----
    print("Logging in...")
    login_resp = api_post("login-with-password", {
        "email": EMAIL,
        "password": PASSWORD,
    })
    profile_id = login_resp.get("id")
    print(f"  Logged in as {login_resp.get('fullname', EMAIL)} (id={profile_id})")

    # ---- Step 2: Create project ----
    print(f"Creating project '{PROJECT_NAME}'...")
    project = api_post("create-project", {
        "team-id": TEAM_ID,
        "name": PROJECT_NAME,
    })
    project_id = project["id"]
    print(f"  Project id: {project_id}")

    # ---- Step 3: Create file ----
    print(f"Creating file '{FILE_NAME}'...")
    file_resp = api_post("create-file", {
        "project-id": project_id,
        "name": FILE_NAME,
    })
    file_id = file_resp["id"]
    print(f"  File id: {file_id}")

    # ---- Step 4: Get file to find page + root frame ----
    print("Fetching file to discover page and root frame...")
    file_data = api_post("get-file", {
        "id": file_id,
        "features": FEATURES,
    })

    data = file_data.get("data", {})
    pages = data.get("pages", [])
    if not pages:
        print("ERROR: no pages found in file", file=sys.stderr)
        sys.exit(1)

    page_id = pages[0]
    print(f"  Page id: {page_id}")

    # Root frame in Penpot is always the nil UUID
    pages_index = data.get("pagesIndex", {})
    page_data = pages_index.get(page_id, {})
    objects = page_data.get("objects", {})
    root_frame_id = list(objects.keys())[0]
    revn = file_data.get("revn", 0)
    vern = file_data.get("vern", 0)
    print(f"  Root frame id: {root_frame_id}")
    print(f"  Revision: {revn}, Version: {vern}")

    # ---- Step 5: Build all card shapes ----
    print("Building card template shapes...")
    session_id = new_uuid()
    changes = []

    pid = page_id
    root = root_frame_id

    # -- Create the card frame (artboard) --
    card_frame_id, card_frame_obj = make_frame(
        "Unit Card", 0, 0, 750, 1050,
        parent_id=root, frame_id=root,
    )
    changes.append(add_obj_change(pid, root, root, card_frame_id, card_frame_obj))

    # All child shapes go inside the card frame
    fid = card_frame_id

    # -- Card Background (dark fill with rounded corners) --
    bg_id, bg_obj = make_rect(
        "Card Background", 0, 0, 750, 1050,
        fills=[{"fill-color": "#1a1a2e", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
        r1=16, r2=16, r3=16, r4=16,
    )
    changes.append(add_obj_change(pid, fid, fid, bg_id, bg_obj))

    # -- Inner Border --
    inner_id, inner_obj = make_rect(
        "Inner Border", 20, 20, 710, 1010,
        fills=[{"fill-color": "#2d2d44", "fill-opacity": 1}],
        strokes=[{"stroke-color": "#3d3d5c", "stroke-opacity": 1, "stroke-width": 2,
                  "stroke-alignment": "center", "stroke-style": "solid"}],
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, inner_id, inner_obj))

    # -- Title bar: Attribute circle --
    circ_id, circ_obj = make_circle(
        "Attribute Circle", 45, 30, 40, 40,
        fills=[{"fill-color": "#3b82f6", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, circ_id, circ_obj))

    # -- Title bar: Card name text --
    name_id, name_obj = make_text(
        "Card Name", 100, 30, 550, 40,
        "Unit Name", font_size="28", font_weight="700",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, name_id, name_obj))

    # -- Title bar: Cost indicator box --
    cost_bg_id, cost_bg_obj = make_rect(
        "Cost Box", 670, 28, 50, 36,
        fills=[{"fill-color": "#d4a843", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
        r1=4, r2=4, r3=4, r4=4,
    )
    changes.append(add_obj_change(pid, fid, fid, cost_bg_id, cost_bg_obj))

    cost_txt_id, cost_txt_obj = make_text(
        "Cost Value", 670, 28, 50, 36,
        "5", font_size="22", font_weight="700",
        fill_color="#000000",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, cost_txt_id, cost_txt_obj))

    # -- Card art placeholder --
    art_id, art_obj = make_rect(
        "Card Art Placeholder", 60, 85, 630, 380,
        fills=[{"fill-color": "#4a4a6a", "fill-opacity": 1}],
        strokes=[{"stroke-color": "#5a5a7a", "stroke-opacity": 1, "stroke-width": 1,
                  "stroke-alignment": "center", "stroke-style": "solid"}],
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, art_id, art_obj))

    # -- Type label background --
    type_bg_id, type_bg_obj = make_rect(
        "Type Banner", 250, 480, 250, 30,
        fills=[{"fill-color": "#1a1a2e", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, type_bg_id, type_bg_obj))

    # -- Type label text --
    type_txt_id, type_txt_obj = make_text(
        "Type Label", 250, 480, 250, 30,
        "WARRIOR", font_size="16", font_weight="600",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, type_txt_id, type_txt_obj))

    # -- Card text area background --
    txtarea_id, txtarea_obj = make_rect(
        "Text Area", 60, 525, 630, 160,
        fills=[{"fill-color": "#252540", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, txtarea_id, txtarea_obj))

    # -- Rules text --
    rules_id, rules_obj = make_text(
        "Rules Text", 75, 535, 600, 80,
        "Card ability text goes here", font_size="14", font_weight="400",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, rules_id, rules_obj))

    # -- Flavor text --
    flavor_id, flavor_obj = make_text(
        "Flavor Text", 75, 640, 600, 40,
        "\"In the vastness of space, courage is the only currency.\"",
        font_size="12", font_weight="400", font_style="italic",
        fill_color="#9999bb",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, flavor_id, flavor_obj))

    # -- Keywords bar --
    kw_bg_id, kw_bg_obj = make_rect(
        "Keywords Bar", 60, 700, 630, 30,
        fills=[{"fill-color": "#1a1a2e", "fill-opacity": 0.5}],
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, kw_bg_id, kw_bg_obj))

    kw_txt_id, kw_txt_obj = make_text(
        "Keywords Text", 70, 700, 610, 30,
        "Keyword1 \u2022 Keyword2", font_size="12", font_weight="400",
        fill_color="#ccccdd",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, kw_txt_id, kw_txt_obj))

    # -- Stats bar: STRENGTH --
    str_bg_id, str_bg_obj = make_rect(
        "Strength Box", 60, 960, 200, 50,
        fills=[{"fill-color": "#dc2626", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
        r1=4, r2=4, r3=4, r4=4,
    )
    changes.append(add_obj_change(pid, fid, fid, str_bg_id, str_bg_obj))

    str_lbl_id, str_lbl_obj = make_text(
        "Strength Label", 70, 962, 120, 18,
        "STRENGTH", font_size="11", font_weight="600",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, str_lbl_id, str_lbl_obj))

    str_val_id, str_val_obj = make_text(
        "Strength Value", 190, 965, 60, 40,
        "5", font_size="24", font_weight="700",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, str_val_id, str_val_obj))

    # -- Stats bar: CUNNING --
    cun_bg_id, cun_bg_obj = make_rect(
        "Cunning Box", 275, 960, 200, 50,
        fills=[{"fill-color": "#2563eb", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
        r1=4, r2=4, r3=4, r4=4,
    )
    changes.append(add_obj_change(pid, fid, fid, cun_bg_id, cun_bg_obj))

    cun_lbl_id, cun_lbl_obj = make_text(
        "Cunning Label", 285, 962, 120, 18,
        "CUNNING", font_size="11", font_weight="600",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, cun_lbl_id, cun_lbl_obj))

    cun_val_id, cun_val_obj = make_text(
        "Cunning Value", 405, 965, 60, 40,
        "5", font_size="24", font_weight="700",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, cun_val_id, cun_val_obj))

    # -- Stats bar: CHARISMA --
    cha_bg_id, cha_bg_obj = make_rect(
        "Charisma Box", 490, 960, 200, 50,
        fills=[{"fill-color": "#16a34a", "fill-opacity": 1}],
        parent_id=fid, frame_id=fid,
        r1=4, r2=4, r3=4, r4=4,
    )
    changes.append(add_obj_change(pid, fid, fid, cha_bg_id, cha_bg_obj))

    cha_lbl_id, cha_lbl_obj = make_text(
        "Charisma Label", 500, 962, 120, 18,
        "CHARISMA", font_size="11", font_weight="600",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, cha_lbl_id, cha_lbl_obj))

    cha_val_id, cha_val_obj = make_text(
        "Charisma Value", 620, 965, 60, 40,
        "5", font_size="24", font_weight="700",
        fill_color="#ffffff",
        parent_id=fid, frame_id=fid,
    )
    changes.append(add_obj_change(pid, fid, fid, cha_val_id, cha_val_obj))

    # ---- Send all shapes in one update-file call ----
    print(f"Sending {len(changes)} shapes to Penpot...")
    update_resp = api_post("update-file", {
        "id": file_id,
        "session-id": session_id,
        "revn": revn,
        "vern": vern,
        "changes": changes,
    })
    print("  File updated successfully.")

    # ---- Summary ----
    print()
    print("=" * 60)
    print("Card template created!")
    print(f"  Project:  {PROJECT_NAME} ({project_id})")
    print(f"  File:     {FILE_NAME} ({file_id})")
    print(f"  Page:     {page_id}")
    print(f"  Shapes:   {len(changes)}")
    print(f"  Open in browser: {BASE_URL}/view/{file_id}?page-id={page_id}")
    print("=" * 60)


if __name__ == "__main__":
    main()
