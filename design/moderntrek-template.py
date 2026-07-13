#!/usr/bin/env python3
"""Render the 'Modern Trek' (V2) unit cards to PNG, data-driven from the library.

Reads library/sets/<set>/units.csv and, for each unit, builds the Modern Trek
unit card in Penpot from the card's own data (name, cost, stats, attributes,
actions, text, flavor, rarity) and exports a PNG. Transcribes the design in
design/genghis-khan-card.svg into Penpot vector shapes via penpot.py.

Rules-faithful choices (see #202):
- The chip row shows the card's governed `attributes` (the synergy axis), not
  an invented "class" — labelled ATTRIBUTES.
- Effect content: one `actions` entry -> an action block (name + AP badge) whose
  body is the card's `text`; zero actions -> a nameless passive block with the
  text; multiple actions -> action-header blocks plus a text block.
- Keyword pills come from the `abilities` column with reminder text from the
  rules glossary. Today no alpha-1 unit populates `abilities`, and the value
  syntax / machine-readable glossary are pending #203, so this is provisional.

Deliberately deferred for v1: Space Grotesk/JetBrains Mono fonts (serif
fallback until vendored, #202), per-attribute icons (#204), grid pattern/mask.

Usage:
    cd design && python3 moderntrek-template.py [../library/sets/alpha-1/units.csv]
"""

import csv
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
DEFAULT_CSV = os.path.join(SCRIPT_DIR, "..", "library", "sets", "alpha-1", "units.csv")

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

# Rarity -> (side-bar gradient start, bright end / footer accent)
RARITY = {
    "legendary": ("#8a6515", "#f4c24a"),
    "epic":      ("#5b2a8a", "#b07cf1"),
    "rare":      ("#1e4a7a", "#4a8fd1"),
    "uncommon":  ("#1e4a7a", "#4a8fd1"),
    "common":    ("#4a5263", "#6c7486"),
}


def _fill(color, opacity=1):
    return [{"fill-color": color, "fill-opacity": opacity}]


def _stroke(color, width, opacity=1, style="solid"):
    return [{"stroke-color": color, "stroke-opacity": opacity,
             "stroke-width": width, "stroke-alignment": "center",
             "stroke-style": style}]


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def parse_glossary():
    """Parse the keyword glossary table in rules/README.md into
    {keyword_lower: (timing, definition)}. Provisional pending #203."""
    path = os.path.join(SCRIPT_DIR, "..", "rules", "README.md")
    glossary = {}
    try:
        with open(path) as f:
            for line in f:
                if not line.lstrip().startswith("|"):
                    continue
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                if len(cells) == 3 and cells[0] not in ("Keyword", "") and "---" not in cells[1]:
                    glossary[cells[0].lower()] = (cells[1], cells[2])
    except OSError:
        pass
    return glossary


def keyword_reminder(ability, glossary):
    """Split an `abilities` entry into (label, reminder). Value-bearing keywords
    like 'Commander 3' substitute the value into the glossary's X placeholder."""
    parts = ability.split()
    value = parts[-1] if len(parts) > 1 and parts[-1].isdigit() else None
    name = " ".join(parts[:-1]) if value else ability
    entry = glossary.get(name.lower())
    reminder = ""
    if entry:
        reminder = entry[1].replace("X", value) if value else entry[1]
    return ability.upper(), reminder


def parse_card(row, index):
    def stat(v):
        return v.strip() if v and v.strip() else "5"

    def split(field):
        return [x.strip() for x in row.get(field, "").split(";") if x.strip()]

    actions = []
    for a in split("actions"):
        name, _, rest = a.partition(":")
        ap, _, effect = rest.partition(":")
        actions.append({"name": name.strip(), "ap": ap.strip(), "effect": effect.strip()})

    return {
        "id": row["id"],
        "name": row["name"],
        "number": f"{index + 1:03d}",
        "set": row.get("set", ""),
        "rarity": (row.get("rarity") or "common").lower(),
        "cost": (row.get("cost") or "").replace("|", " / "),
        "str": stat(row.get("strength")),
        "cun": stat(row.get("cunning")),
        "cha": stat(row.get("charisma")),
        "attributes": split("attributes"),
        "abilities": split("abilities"),
        "actions": actions,
        "text": (row.get("text") or "").strip(),
        "flavor": (row.get("flavor") or "").strip(),
    }


# ---------------------------------------------------------------------------
# Shape building (parameterised by card data)
# ---------------------------------------------------------------------------

RULES_TOP = 520          # top of the rules-panel content
BLOCK_X, BLOCK_W = 26, 698
BODY_X, BODY_W = 36, 676
BODY_LINE_H = 18         # 14px * ~1.3
NAME_TOP, NAMED_BODY_TOP, BARE_BODY_TOP = 6, 41, 12
PAD_BOTTOM, BLOCK_GAP = 8, 14
FLAVOR_Y = 876           # flavor pinned near the panel bottom


def build_shapes(page_id, frame_id, card, glossary):
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

    rarity = card["rarity"]
    r_start, r_bright = RARITY.get(rarity, RARITY["common"])

    # 1. Card background + art placeholder + header
    rect("Card Background", 0, 0, 750, 1050, fills=_fill(C["card_bg"]),
         r1=14, r2=14, r3=14, r4=14)
    art_bg = make_radial_gradient_fill(0.5, 0.4, 0.5, 1.02, 1, [
        {"color": "#1c2a48", "offset": 0, "opacity": 1},
        {"color": "#0a1220", "offset": 0.78, "opacity": 1}])
    rect("Art Area", 0, 0, 750, 440, fills=[art_bg])
    header_bg = make_linear_gradient_fill(0.5, 0, 0.5, 1, [
        {"color": "#0a1220", "offset": 0, "opacity": 0.92},
        {"color": "#0a1220", "offset": 1, "opacity": 0.7}])
    rect("Header Bar", 0, 0, 750, 76, fills=[header_bg], r1=14, r2=14, r3=0, r4=0)
    rect("Header Border", 0, 75, 750, 1, fills=_fill(C["lime"], 0.2))

    # Set tag + name + cost coin
    rect("Set Tag Chip", 26, 27, 44, 22, fills=[], r1=2, r2=2, r3=2, r4=2,
         strokes=_stroke(C["lime"], 1, 0.4))
    text("Set Tag", 26, 31, 44, 16, card["number"], JB, "10", "400", C["lime"],
         align="center", ls=2)
    text("Card Name", 84, 20, 560, 42, card["name"], SG, "30", "600", C["text"], ls=-0.3)
    coin = make_radial_gradient_fill(0.35, 0.3, 0.35, 1.1, 1, [
        {"color": "#ffe9a8", "offset": 0, "opacity": 1},
        {"color": "#f4c24a", "offset": 0.55, "opacity": 1},
        {"color": "#a3761a", "offset": 1, "opacity": 1}])
    circle("Cost Coin", 668, 8, 60, 60, [coin], strokes=_stroke(C["coin_border"], 2),
           shadow=[make_shadow("#f4c24a", 20, 0.33)])
    circle("Cost Ring", 671, 11, 54, 54, [], strokes=_stroke("#ffe9a8", 3, 0.33))
    text("Cost Value", 668, 22, 60, 36, card["cost"], SG, "28", "800", C["coin_text"],
         align="center")

    # 2. Attribute bar (the governed synergy axis — chips, no icons for v1)
    rect("Attr Bar", 0, 440, 750, 62, fills=_fill(C["band"]))
    rect("Attr Bar Top", 0, 440, 750, 1, fills=_fill(C["lime"], 0.2))
    rect("Attr Bar Bottom", 0, 501, 750, 1, fills=_fill(C["hairline"]))
    text("Attr Label", 26, 464, 110, 14, "ATTRIBUTES", JB, "10", "400", C["muted"], ls=2)
    cx = 150
    for i, attr in enumerate(card["attributes"][:5]):
        w = int(len(attr) * 13 * 0.62) + 26
        rect(f"Attr Chip {i}", cx, 455, w, 32, fills=_fill(C["panel"]),
             r1=4, r2=4, r3=4, r4=4, strokes=_stroke(C["lime"], 1, 0.27))
        text(f"Attr {i}", cx, 459, w, 20, attr.upper(), SG, "13", "500", C["text"],
             align="center", ls=1.2)
        cx += w + 12

    # 3. Rules panel
    rect("Rules Panel", 0, 502, 750, 410, fills=_fill(C["panel"]))
    cursor = RULES_TOP

    # Keyword pills from `abilities` (+ reminder). Empty for alpha-1 today.
    for i, kw in enumerate(card["abilities"]):
        label, reminder = keyword_reminder(kw, glossary)
        pw = int(len(label) * 11 * 0.62) + 24
        rect(f"KW Pill {i}", 26, cursor, pw, 25, fills=_fill(C["lime"]),
             r1=2, r2=2, r3=2, r4=2)
        text(f"KW Label {i}", 26, cursor + 4, pw, 18, label, SG, "11", "700",
             C["card_bg"], align="center", ls=1.6)
        if reminder:
            text(f"KW Reminder {i}", 26 + pw + 12, cursor + 4, 690 - (26 + pw + 12), 18,
                 reminder, SG, "12.5", "400", C["muted"], style="italic")
        cursor += 33

    # Effect blocks (action/passive) with content-driven heights
    for i, b in enumerate(_blocks_for(card)):
        cursor = _render_block(rect, text, i, b, cursor)

    # Flavor (pinned near the panel bottom)
    if card["flavor"]:
        rect("Flavor Divider", 26, FLAVOR_Y - 7, 698, 1, fills=_fill(C["lime"], 0.13))
        text("Flavor Text", 26, FLAVOR_Y, 698, 18, f'"{card["flavor"]}"', SG, "12",
             "400", C["muted"], style="italic")

    # 4. Stat ribbon
    rect("Stat Ribbon", 0, 938, 750, 74, fills=_fill(C["band"]))
    rect("Ribbon Top", 0, 938, 750, 1, fills=_fill(C["lime"], 0.27))
    rect("Ribbon Bottom", 0, 1011, 750, 1, fills=_fill(C["lime"], 0.13))
    rect("Ribbon Div 1", 249, 938, 1, 74, fills=_fill(C["hairline"]))
    rect("Ribbon Div 2", 499, 938, 1, 74, fills=_fill(C["hairline"]))
    stats = [
        ("STR", 93, 121, card["str"], C["str"], C["str_glow"]),
        ("CUN", 343, 371, card["cun"], C["cun"], C["cun_glow"]),
        ("CHA", 593, 621, card["cha"], C["cha"], C["cha_glow"]),
    ]
    for label, orb_x, txt_x, val, color, glow in stats:
        orb = make_radial_gradient_fill(0.3, 0.3, 0.3, 1.15, 1, [
            {"color": "#ffffff", "offset": 0, "opacity": 1},
            {"color": color, "offset": 0.55, "opacity": 1},
            {"color": "#0a1220", "offset": 1, "opacity": 1}])
        circle(f"Orb {label}", orb_x, 968, 14, 14, [orb],
               shadow=[make_shadow(glow, 10, 0.67)])
        text(f"Label {label}", txt_x, 950, 40, 14, label, JB, "10", "400", color, ls=2)
        text(f"Value {label}", txt_x, 964, 60, 40, val, SG, "36", "700", "#ffffff",
             shadow=[make_shadow(glow, 12, 0.53)])

    # 5. Footer + rarity side bar
    text("Footer Rarity", 26, 1019, 300, 14, f"◆ {rarity.upper()}", JB, "9",
         "700", r_bright, ls=1.8)
    text("Footer Set", 424, 1019, 300, 14,
         f"UNIT // {card['set'].upper()} · {card['number']}", JB, "9", "400",
         C["muted"], align="right", ls=1.8)
    side = make_linear_gradient_fill(0, 0.5, 1, 0.5, [
        {"color": r_start, "offset": 0, "opacity": 1},
        {"color": r_bright, "offset": 1, "opacity": 1}])
    rect("Rarity Side Bar", 0, 0, 6, 1050, fills=[side])

    return ch


def _blocks_for(card):
    """Turn a card's actions/text into a list of renderable blocks."""
    actions, text = card["actions"], card["text"]
    if len(actions) == 1:
        return [{"kind": "action", "name": actions[0]["name"], "ap": actions[0]["ap"],
                 "body": text}]
    if not actions:
        return [{"kind": "passive", "name": None, "body": text}] if text else []
    blocks = [{"kind": "action", "name": a["name"], "ap": a["ap"], "body": ""}
              for a in actions]
    if text:
        blocks.append({"kind": "passive", "name": None, "body": text})
    return blocks


def _render_block(rect, text, i, b, cursor):
    """Render one effect block at `cursor`, return the next cursor position."""
    action = b["kind"] == "action"
    accent = C["lime"] if action else C["passive"]
    has_name = bool(b["name"])
    body_top = NAMED_BODY_TOP if has_name else BARE_BODY_TOP

    n_lines = len(_wrap_lines(b["body"], BODY_W, 14, CHAR_ADVANCE)) if b["body"] else 0
    block_h = body_top + n_lines * BODY_LINE_H + PAD_BOTTOM

    if action:
        rect(f"Block {i}", BLOCK_X, cursor, BLOCK_W, block_h,
             fills=_fill(C["card_bg"], 0.67), r1=6, r2=6, r3=6, r4=6,
             strokes=_stroke(accent, 1, 0.27))
    else:
        rect(f"Block {i}", BLOCK_X, cursor, BLOCK_W, block_h, fills=[],
             r1=6, r2=6, r3=6, r4=6, strokes=_stroke(accent, 1.5, 0.4, "dashed"))

    if has_name:
        text(f"Block {i} Name", BODY_X, cursor + NAME_TOP, 300, 30,
             b["name"].capitalize(), SG, "22", "700", accent, ls=-0.22,
             shadow=[make_shadow(accent, 20, 0.27)])
        if action and b["ap"]:
            pill = f"{b['ap']} AP"
            name_w = len(b["name"]) * 22 * 0.56
            pill_w = int(len(pill) * 11 * 0.62) + 22
            pill_x = int(BODY_X + name_w + 12)
            rect(f"Block {i} Pill", pill_x, cursor + 13, pill_w, 21,
                 fills=_fill(accent), r1=3, r2=3, r3=3, r4=3,
                 shadow=[make_shadow(accent, 10, 0.33)])
            text(f"Block {i} Tag", pill_x, cursor + 16, pill_w, 17, pill, JB, "11",
                 "800", C["card_bg"], align="center", ls=1.5)

    if b["body"]:
        text(f"Block {i} Body", BODY_X, cursor + body_top, BODY_W,
             n_lines * BODY_LINE_H, b["body"], SG, "14", "400", C["text"])

    return cursor + block_h + BLOCK_GAP


# ---------------------------------------------------------------------------
# Penpot file plumbing
# ---------------------------------------------------------------------------

def _try_get_file(client, file_id):
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
    env_path = os.path.join(SCRIPT_DIR, ".env")
    lines, found = [], False
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


def _delete_frame_changes(objects, page_id):
    changes = []
    for oid, obj in objects.items():
        if obj.get("name") == FRAME_NAME and obj.get("type") == "frame":
            for cid, cobj in objects.items():
                if cobj.get("frame-id", cobj.get("frameId")) == oid and cid != oid:
                    changes.append(del_obj_change(page_id, cid))
            changes.append(del_obj_change(page_id, oid))
            break
    return changes


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    file_id = os.environ.get("PENPOT_FILE_ID")
    page_id = os.environ.get("PENPOT_PAGE_ID")

    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    print(f"Loaded {len(rows)} units from {csv_path}")

    client = PenpotClient()
    print("Logging in...")
    client.login()

    file_data = _try_get_file(client, file_id) if file_id else None
    if file_data is None:
        print("No usable file — creating a fresh Penpot project + file...")
        profile = client.api_post("get-profile", {})
        project = client.api_post("create-project", {
            "team-id": profile.get("defaultTeamId"), "name": "Card Game"})
        file_id = client.api_post("create-file", {
            "project-id": project["id"], "name": "Card Templates"})["id"]
        _persist_file_id(file_id)
        print(f"  Created file {file_id} (saved to .env)")

    glossary = parse_glossary()
    out_dir = os.path.join(SCRIPT_DIR, "exports")
    os.makedirs(out_dir, exist_ok=True)

    for i, row in enumerate(rows):
        card = parse_card(row, i)
        file_data = client.get_file(file_id)
        if not page_id:
            page_id = file_data["data"]["pages"][0]
        objects = client.get_page_objects(file_data, page_id)
        root_id = file_data["data"]["pagesIndex"][page_id].get("id", list(objects.keys())[0])

        changes = _delete_frame_changes(objects, page_id)
        frame_id, frame_change = make_frame(FRAME_NAME, 0, 0, 750, 1050,
                                            page_id, root_id, root_id,
                                            fills=[{"fill-color": "#0a1220", "fill-opacity": 0}])
        changes.append(frame_change)
        changes.extend(build_shapes(page_id, frame_id, card, glossary))
        client.update_file(file_id, changes, file_data["revn"], file_data.get("vern", 0))

        data = client.export_png(file_id, page_id, frame_id)
        out_path = os.path.join(out_dir, f"{card['id']}.png")
        with open(out_path, "wb") as fout:
            fout.write(data)
        print(f"[{i + 1}/{len(rows)}] {card['name']} -> {os.path.basename(out_path)} "
              f"({len(data)} bytes)")

    print(f"\nDone. {len(rows)} unit PNGs in {out_dir}")


if __name__ == "__main__":
    main()
