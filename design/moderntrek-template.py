#!/usr/bin/env python3
"""Prototype: build the 'Modern Trek' V2 unit card in Penpot and export a PNG.

Transcribes design/genghis-khan-card.svg into Penpot vector shapes (via
penpot.py), with the Genghis Khan example content baked in — mirroring how
setup-template.py bakes placeholder content into the static template.

Goal for this step: validate that the Penpot pipeline can reproduce the
Modern Trek theme, glows included. Data-driven population from CSV (and the
schema gaps it exposes) is a separate follow-up.

Deliberately dropped for v1 (see conversation): the art-area grid pattern +
radial-fade mask, the class-chip icons, and the unit-glyph silhouette. The
art area is a plain gradient placeholder until real art exists.

Usage:
    cd design && python3 moderntrek-template.py
"""

import json
import os
import sys
import urllib.error
import urllib.request

from penpot import (
    PenpotClient, FEATURES,
    make_rect, make_circle, make_text, make_frame,
    make_linear_gradient_fill, make_radial_gradient_fill, make_shadow,
    del_obj_change, _wrap_lines, CHAR_ADVANCE,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FRAME_NAME = "Unit Card MT"

# --- Fonts (Google Fonts; Penpot bundles the GF library) --------------------
SG = {"font_family": "spacegrotesk", "font_id": "gfont-space-grotesk"}
JB = {"font_family": "jetbrainsmono", "font_id": "gfont-jetbrains-mono"}

# --- Palette (from card-spec.json) ------------------------------------------
C = {
    "card_bg": "#0a1220",
    "panel": "#0f1a2e",
    "band": "#060c18",
    "hairline": "#1a2540",
    "lime": "#c8f562",
    "text": "#e6ecf6",
    "muted": "#7a8aa6",
    "passive": "#8fb0ff",
    "coin_border": "#8a6522",
    "coin_text": "#3a2205",
    "str": "#ff6b6b", "str_glow": "#ff3636",
    "cun": "#6bb6ff", "cun_glow": "#2e7bd6",
    "cha": "#c8f562", "cha_glow": "#c8f562",
}


def _fill(color, opacity=1):
    return [{"fill-color": color, "fill-opacity": opacity}]


def _stroke(color, width, opacity=1, style="solid"):
    return [{"stroke-color": color, "stroke-opacity": opacity,
             "stroke-width": width, "stroke-alignment": "center",
             "stroke-style": style}]


def build_shapes(page_id, frame_id):
    """Return the list of add-obj changes for the Modern Trek unit card."""
    ch = []

    def rect(name, x, y, w, h, **kw):
        _, c = make_rect(name, x, y, w, h, kw.pop("fills", _fill(C["card_bg"])),
                         page_id, frame_id, frame_id, **kw)
        ch.append(c)

    def circle(name, x, y, w, h, fills, **kw):
        _, c = make_circle(name, x, y, w, h, fills, page_id, frame_id, frame_id, **kw)
        ch.append(c)

    def text(name, x, y, w, h, s, font, size, weight="400", color=C["text"],
             align=None, style=None, ls=None, shadow=None):
        _, c = make_text(name, x, y, w, h, s, page_id, frame_id, frame_id,
                         font_size=size, font_weight=weight, fill_color=color,
                         text_align=align, font_style=style, letter_spacing=ls,
                         shadow=shadow, **font)
        ch.append(c)

    # 1. Card background (rounded)
    rect("Card Background", 0, 0, 750, 1050, fills=_fill(C["card_bg"]),
         r1=14, r2=14, r3=14, r4=14)

    # 2. Art area — radial gradient placeholder (grid pattern dropped)
    art_bg = make_radial_gradient_fill(0.5, 0.4, 0.5, 1.02, 1, [
        {"color": "#1c2a48", "offset": 0, "opacity": 1},
        {"color": "#0a1220", "offset": 0.78, "opacity": 1}])
    rect("Art Area", 0, 0, 750, 440, fills=[art_bg])

    # 3. Header bar (linear gradient) + bottom hairline. Top corners rounded so
    #    the square band doesn't cover the card's rounded corners.
    header_bg = make_linear_gradient_fill(0.5, 0, 0.5, 1, [
        {"color": "#0a1220", "offset": 0, "opacity": 0.92},
        {"color": "#0a1220", "offset": 1, "opacity": 0.7}])
    rect("Header Bar", 0, 0, 750, 76, fills=[header_bg], r1=14, r2=14, r3=0, r4=0)
    rect("Header Border", 0, 75, 750, 1, fills=_fill(C["lime"], 0.2))

    # 4. Set tag chip + number
    rect("Set Tag Chip", 26, 27, 44, 22, fills=[], r1=2, r2=2, r3=2, r4=2,
         strokes=_stroke(C["lime"], 1, 0.4))
    text("Set Tag", 26, 31, 44, 16, "005", JB, "10", "400", C["lime"],
         align="center", ls=2)

    # 5. Card name
    text("Card Name", 84, 20, 560, 42, "Genghis Khan", SG, "30", "600",
         C["text"], ls=-0.3)

    # 6. Cost coin (radial gradient + glow) + inner ring + value
    coin = make_radial_gradient_fill(0.35, 0.3, 0.35, 1.1, 1, [
        {"color": "#ffe9a8", "offset": 0, "opacity": 1},
        {"color": "#f4c24a", "offset": 0.55, "opacity": 1},
        {"color": "#a3761a", "offset": 1, "opacity": 1}])
    circle("Cost Coin", 668, 8, 60, 60, [coin],
           strokes=_stroke(C["coin_border"], 2),
           shadow=[make_shadow("#f4c24a", 20, 0.33)])
    circle("Cost Ring", 671, 11, 54, 54, [], strokes=_stroke("#ffe9a8", 3, 0.33))
    text("Cost Value", 668, 22, 60, 36, "7", SG, "28", "800", C["coin_text"],
         align="center")

    # 7. Class bar
    rect("Class Bar", 0, 440, 750, 62, fills=_fill(C["band"]))
    rect("Class Bar Top", 0, 440, 750, 1, fills=_fill(C["lime"], 0.2))
    rect("Class Bar Bottom", 0, 501, 750, 1, fills=_fill(C["hairline"]))
    text("Class Label", 26, 464, 60, 14, "CLASS", JB, "10", "400", C["muted"], ls=2)
    # Class chips (icons dropped — text only)
    rect("Class Chip 1", 84, 455, 118, 32, fills=_fill(C["panel"]),
         r1=4, r2=4, r3=4, r4=4, strokes=_stroke(C["lime"], 1, 0.27))
    text("Class 1", 100, 459, 100, 20, "WARRIOR", SG, "13", "500", C["text"], ls=1.8)
    rect("Class Chip 2", 216, 455, 146, 32, fills=_fill(C["panel"]),
         r1=4, r2=4, r3=4, r4=4, strokes=_stroke(C["lime"], 1, 0.27))
    text("Class 2", 232, 459, 120, 20, "POLITICIAN", SG, "13", "500", C["text"], ls=1.8)

    # 8. Rules panel
    rect("Rules Panel", 0, 502, 750, 410, fills=_fill(C["panel"]))

    # Keyword pill + reminder
    rect("Keyword Pill", 26, 520, 126, 25, fills=_fill(C["lime"]),
         r1=2, r2=2, r3=2, r4=2)
    text("Keyword Label", 26, 524, 126, 18, "COMMANDER 1", SG, "11", "700",
         C["card_bg"], align="center", ls=2)
    text("Keyword Reminder", 162, 522, 550, 18,
         "Friendly units at this location get +1 Strength.", SG, "12.5", "400",
         C["muted"], style="italic")

    # Ability / passive blocks — flowed top-down with content-driven heights.
    # Each block grows to fit its wrapped body text; the next block starts below.
    ability_blocks = [
        {"kind": "action", "name": "Conquer", "pill": "3 AP",
         "color": C["lime"], "glow": C["lime"],
         "body": "Raze target location. Place it in your HQ instead of "
                 "discarding. Mission VP is not awarded."},
        {"kind": "passive", "name": "Horselord", "pill": "PASSIVE",
         "color": C["passive"], "glow": C["passive"],
         "body": "Your Equip actions involving a Mount cost 0 AP."},
    ]

    BLOCK_X, BLOCK_W = 26, 698
    BODY_X, BODY_W = 36, 676
    BODY_FS, BODY_LINE_H = 14, 18           # 14px * ~1.3 line height
    NAME_TOP, BODY_TOP = 6, 41              # offsets from block top
    PAD_BOTTOM, BLOCK_GAP = 8, 14

    cursor = 555
    for i, b in enumerate(ability_blocks):
        n_lines = len(_wrap_lines(b["body"], BODY_W, BODY_FS, CHAR_ADVANCE))
        body_h = n_lines * BODY_LINE_H
        block_h = BODY_TOP + body_h + PAD_BOTTOM

        if b["kind"] == "action":
            rect(f"Block {i}", BLOCK_X, cursor, BLOCK_W, block_h,
                 fills=_fill(C["card_bg"], 0.67), r1=6, r2=6, r3=6, r4=6,
                 strokes=_stroke(b["color"], 1, 0.27))
        else:
            rect(f"Block {i}", BLOCK_X, cursor, BLOCK_W, block_h, fills=[],
                 r1=6, r2=6, r3=6, r4=6,
                 strokes=_stroke(b["color"], 1.5, 0.4, "dashed"))

        text(f"Block {i} Name", BODY_X, cursor + NAME_TOP, 300, 30, b["name"],
             SG, "22", "700", b["color"], ls=-0.22,
             shadow=[make_shadow(b["glow"], 20, 0.27)])

        # Pill sits just after the name; width scales with the label.
        name_w = len(b["name"]) * 22 * 0.56
        pill_w = int(len(b["pill"]) * 11 * 0.62) + 22
        pill_x = int(BODY_X + name_w + 12)
        pill_y = cursor + 13
        if b["kind"] == "action":
            rect(f"Block {i} Pill", pill_x, pill_y, pill_w, 21,
                 fills=_fill(b["color"]), r1=3, r2=3, r3=3, r4=3,
                 shadow=[make_shadow(b["glow"], 10, 0.33)])
            text(f"Block {i} Tag", pill_x, pill_y + 3, pill_w, 17, b["pill"],
                 JB, "11", "800", C["card_bg"], align="center", ls=1.5)
        else:
            rect(f"Block {i} Pill", pill_x, pill_y, pill_w, 21, fills=[],
                 r1=3, r2=3, r3=3, r4=3, strokes=_stroke(b["color"], 1, 0.53))
            text(f"Block {i} Tag", pill_x, pill_y + 3, pill_w, 17, b["pill"],
                 JB, "11", "800", b["color"], align="center", ls=1.5)

        text(f"Block {i} Body", BODY_X, cursor + BODY_TOP, BODY_W, body_h,
             b["body"], SG, "14", "400", C["text"])

        cursor += block_h + BLOCK_GAP

    # Flavor
    rect("Flavor Divider", 26, 869, 698, 1, fills=_fill(C["lime"], 0.13))
    text("Flavor Text", 26, 876, 698, 18, '"He did not build. He took."', SG,
         "12", "400", C["muted"], style="italic")

    # 9. Stat ribbon
    rect("Stat Ribbon", 0, 938, 750, 74, fills=_fill(C["band"]))
    rect("Ribbon Top", 0, 938, 750, 1, fills=_fill(C["lime"], 0.27))
    rect("Ribbon Bottom", 0, 1011, 750, 1, fills=_fill(C["lime"], 0.13))
    rect("Ribbon Div 1", 249, 938, 1, 74, fills=_fill(C["hairline"]))
    rect("Ribbon Div 2", 499, 938, 1, 74, fills=_fill(C["hairline"]))

    stats = [
        ("STR", 93, 121, "8", C["str"], C["str_glow"]),
        ("CUN", 343, 371, "7", C["cun"], C["cun_glow"]),
        ("CHA", 593, 621, "6", C["cha"], C["cha_glow"]),
    ]
    for label, orb_x, txt_x, val, color, glow in stats:
        orb = make_radial_gradient_fill(0.3, 0.3, 0.3, 1.15, 1, [
            {"color": "#ffffff", "offset": 0, "opacity": 1},
            {"color": color, "offset": 0.55, "opacity": 1},
            {"color": "#0a1220", "offset": 1, "opacity": 1}])
        circle(f"Orb {label}", orb_x, 968, 14, 14, [orb],
               shadow=[make_shadow(glow, 10, 0.67)])
        text(f"Label {label}", txt_x, 950, 40, 14, label, JB, "10", "400",
             color, ls=2)
        text(f"Value {label}", txt_x, 964, 60, 40, val, SG, "36", "700",
             "#ffffff", shadow=[make_shadow(glow, 12, 0.53)])

    # 10. Footer
    text("Footer Rarity", 26, 1019, 300, 14, "◆ LEGENDARY", JB, "9", "700",
         C["lime"], ls=1.8)
    text("Footer Set", 424, 1019, 300, 14, "UNIT // ALPHA-1 · 005", JB, "9",
         "400", C["muted"], align="right", ls=1.8)

    # 11. Rarity side bar (on top)
    side = make_linear_gradient_fill(0, 0.5, 1, 0.5, [
        {"color": "#8a6515", "offset": 0, "opacity": 1},
        {"color": "#f4c24a", "offset": 1, "opacity": 1}])
    rect("Rarity Side Bar", 0, 0, 6, 1050, fills=[side])

    return ch


def _try_get_file(client, file_id):
    """Fetch a file, returning None if it no longer exists (404) instead of exiting."""
    url = f"{client.api_url}/get-file"
    data = json.dumps({"id": file_id, "features": FEATURES}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with client.opener.open(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def _persist_file_id(file_id):
    """Write the new PENPOT_FILE_ID back into design/.env for reuse."""
    env_path = os.path.join(SCRIPT_DIR, ".env")
    lines = []
    found = False
    if os.path.isfile(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("PENPOT_FILE_ID="):
                    lines.append(f"PENPOT_FILE_ID={file_id}\n")
                    found = True
                else:
                    lines.append(line)
    if not found:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(f"PENPOT_FILE_ID={file_id}\n")
    with open(env_path, "w") as f:
        f.writelines(lines)


def main():
    file_id = os.environ.get("PENPOT_FILE_ID")
    page_id = os.environ.get("PENPOT_PAGE_ID")

    client = PenpotClient()
    print("Logging in...")
    client.login()

    file_data = _try_get_file(client, file_id) if file_id else None
    if file_data is None:
        print("No usable file — creating a fresh Penpot project + file...")
        profile = client.api_post("get-profile", {})
        team_id = profile.get("defaultTeamId")
        project = client.api_post("create-project", {
            "team-id": team_id, "name": "Card Game"})
        file_resp = client.api_post("create-file", {
            "project-id": project["id"], "name": "Card Templates"})
        file_id = file_resp["id"]
        _persist_file_id(file_id)
        print(f"  Created file {file_id} (saved to .env)")
        file_data = client.get_file(file_id)
    revn = file_data["revn"]
    vern = file_data.get("vern", 0)
    if not page_id:
        page_id = file_data["data"]["pages"][0]

    objects = client.get_page_objects(file_data, page_id)
    root_id = file_data["data"]["pagesIndex"][page_id].get("id", list(objects.keys())[0])

    # Idempotent: delete existing MT frame (and its children) if present
    changes = []
    for oid, obj in objects.items():
        if obj.get("name") == FRAME_NAME and obj.get("type") == "frame":
            print(f"Deleting existing '{FRAME_NAME}' frame...")
            for cid, cobj in objects.items():
                if cobj.get("frame-id", cobj.get("frameId")) == oid and cid != oid:
                    changes.append(del_obj_change(page_id, cid))
            changes.append(del_obj_change(page_id, oid))
            break

    print(f"Creating '{FRAME_NAME}' frame + shapes...")
    frame_id, frame_change = make_frame(FRAME_NAME, 0, 0, 750, 1050,
                                        page_id, root_id, root_id,
                                        fills=[{"fill-color": "#0a1220", "fill-opacity": 0}])
    changes.append(frame_change)
    changes.extend(build_shapes(page_id, frame_id))

    print(f"Sending {len(changes)} changes...")
    resp = client.update_file(file_id, changes, revn, vern)
    print(f"  revn={resp.get('revn', '?')}")

    print("Exporting PNG...")
    data = client.export_png(file_id, page_id, frame_id)
    out_dir = os.path.join(SCRIPT_DIR, "exports")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "moderntrek-genghis-khan.png")
    with open(out_path, "wb") as f:
        f.write(data)
    print(f"Saved {out_path} ({len(data)} bytes)")
    print(f"View in Penpot: {client.base_url}/view/{file_id}")


if __name__ == "__main__":
    main()
