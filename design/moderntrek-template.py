#!/usr/bin/env python3
"""Render 'Modern Trek' (V2) cards to PNG, data-driven from the card library.

Reads library/sets/<set>/<type>.csv and builds each card in Penpot from its own
data, then exports a PNG. Card type is detected from the CSV filename; all five
types are supported (units, locations, items, events, policies), transcribed
from the design specs/SVGs in design/specs/ into Penpot vector shapes via
penpot.py. Output goes to exports/<set>/<type>-<id>.png.

Rules-faithful choices (the library is the source of truth, not the design; #202):
- Units show the governed `attributes` (synergy axis) as chips, not an invented
  "class". Locations map `edges` -> compass (blocked = red bar, rest open).
  Items/events/policies read their dedicated columns (equip/stored,
  timing/trigger/text, effect/seeding_effect) — cleanly separated, no blob.
- Where a type has only a freeform `text` blob (units, location actions), it is
  rendered as-is; per-effect structuring is tracked with the keyword work (#203).
- Unit keyword pills come from `abilities` + the glossary artifact
  (`library/build/glossary.json`, the #203 render↔data contract); dormant until
  cards populate `abilities` (#194/#198).

Deliberately deferred for v1: type/attribute glyph icons (#204), the diagonal
hatch texture, and the event hazard-stripe top edge (solid bar for now).
Fonts (Space Grotesk / JetBrains Mono) are vendored in design/fonts/ and served
to the exporter via the docker-compose font mount.

Usage:
    cd design && python3 moderntrek-template.py [../library/sets/alpha-1/units.csv]
"""

import csv
import json
import os
import re
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
DEFAULT_CSV = os.path.join(SCRIPT_DIR, "..", "library", "sets", "alpha-1", "units.csv")

# Baseline printed for a missing/blank unit stat. Mirrors rules
# [var:default_stat:5]; the renderer isn't variant-aware, so update this if that
# baseline changes.
DEFAULT_STAT = "5"

# Location mission requirement keys that are stat *thresholds* ("combined stat
# >= N across friendly units") rather than counts of units/attributes. Rendered
# as "STRENGTH ≥15" instead of "STRENGTH ×15".
STAT_REQ_KEYS = {"strength", "cunning", "charisma"}

# --- Fonts ------------------------------------------------------------------
# family names match the vendored TTFs in design/fonts/, mounted into the
# exporter's system font path (see docker-compose.yaml). The exporter renders
# text by these family names via fontconfig — no external Google Fonts fetch.
SG = {"font_family": "Space Grotesk", "font_id": "gfont-space-grotesk"}
JB = {"font_family": "JetBrains Mono", "font_id": "gfont-jetbrains-mono"}

# --- Palette (from design/specs/*.json; the unit spec is the source of truth,
#     one palette is shared across all five card types) -----------------------
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
    "glass": "#060c18",       # header/footer glass boxes (locations + all portrait types)
    "edge_blocked": "#ff5a4e",
    "edge_open": "#7a8aa6",
}

# Rarity -> (side-bar gradient start, bright end). Footer rarity text is always
# lime; rarity is conveyed by the gem symbol (+ the unit side-bar gradient).
RARITY = {
    "legendary": ("#8a6515", "#f4c24a"),
    "epic":      ("#5b2a8a", "#b07cf1"),
    "rare":      ("#1e4a7a", "#4a8fd1"),
    "uncommon":  ("#1e4a7a", "#4a8fd1"),
    "common":    ("#4a5263", "#6c7486"),
}
RARITY_GEM = {"common": "●", "uncommon": "◇", "rare": "◈", "epic": "◆", "legendary": "★"}


def _fill(color, opacity=1):
    return [{"fill-color": color, "fill-opacity": opacity}]


def _stroke(color, width, opacity=1, style="solid"):
    return [{"stroke-color": color, "stroke-opacity": opacity,
             "stroke-width": width, "stroke-alignment": "center",
             "stroke-style": style}]


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def parse_glossary(path=None, rules_path=None):
    """Load the machine-readable keyword glossary emitted by the library build
    (`library/build/glossary.json`, the #203 render↔data contract) into
    `{keyword_id: {name, scope, timing, apCost?, valued, reminder}}`.

    `rules/README.md` stays the human-authored source; `bun library/build.ts`
    derives this artifact from it (and validates card `abilities` against it), so
    the renderer reads one contract instead of re-parsing prose. It's a build
    output: run the build to (re)generate it. If it's missing, unreadable, or
    older than the rules it derives from, the renderer warns and degrades to
    blank keyword reminders rather than failing the whole export.

    `path`/`rules_path` default to the real artifact and rules locations; they're
    parameterised so tests can drive the degradation paths against fixtures."""
    if path is None:
        path = os.path.join(SCRIPT_DIR, "..", "library", "build", "glossary.json")
    if rules_path is None:
        rules_path = os.path.join(SCRIPT_DIR, "..", "rules", "README.md")
    if not os.path.exists(path):
        print(f"WARNING: glossary artifact not found at {path} — run "
              f"`bun library/build.ts` to generate it; keyword reminders will be "
              f"blank", file=sys.stderr)
        return {}
    try:
        with open(path) as f:
            glossary = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"WARNING: glossary artifact unreadable at {path}: {exc} — keyword "
              f"reminders will be blank", file=sys.stderr)
        return {}
    if not isinstance(glossary, dict):
        print(f"WARNING: glossary artifact at {path} is not a JSON object (got "
              f"{type(glossary).__name__}) — keyword reminders will be blank",
              file=sys.stderr)
        return {}
    # mtime is a cheap staleness *proxy*, not a guarantee: an operation that
    # rewrites rules/README.md without rebuilding the (git-ignored) artifact —
    # e.g. a git checkout/stash — can trip a false "stale" warning. Fine for a
    # non-blocking heads-up.
    try:
        if os.path.getmtime(path) < os.path.getmtime(rules_path):
            print(f"WARNING: {path} is older than rules/README.md — it may be "
                  f"stale; re-run `bun library/build.ts`", file=sys.stderr)
    except OSError as exc:
        print(f"WARNING: could not compare glossary/rules timestamps ({exc}) — "
              f"staleness not checked", file=sys.stderr)
    return glossary


# `ident value?` where a value is `[N]` — mirrors the library's ABILITY_TOKEN
# (library/glossary.ts) and the effect-DSL `token` grammar (#203).
_ABILITY_TOKEN = re.compile(r"^([A-Za-z][A-Za-z-]*)(?:\[(\d+)\])?$")


def keyword_reminder(ability, glossary):
    """Split an `abilities` token into (label, reminder). Value-bearing keywords
    like `Commander[3]` substitute the value into the glossary's X placeholder;
    the pill label renders the value space-separated (`COMMANDER 3`). Degrades to
    a blank reminder — never raises — on an unknown keyword, a malformed token, or
    a malformed/incomplete glossary entry (see parse_glossary's shape note)."""
    m = _ABILITY_TOKEN.match(ability.strip())
    if not m:
        return ability.upper(), ""
    name, value = m.group(1), m.group(2)
    entry = glossary.get(name.lower())
    if not isinstance(entry, dict) or "reminder" not in entry:
        # Unknown keyword, or a wrong-shape artifact entry — label as written, no
        # reminder. Guarding here (not just entry truthiness) keeps a corrupt
        # glossary.json from crashing the export deep in shape-building.
        return (f"{name} {value}" if value else name).upper(), ""
    display = entry.get("name", name)
    reminder = entry["reminder"]
    valued = entry.get("valued", "X" in reminder)
    # Arity mismatches the full build would have caught (reachable on a partial
    # build or hand-edited data) — warn and degrade, never print a literal "X" or
    # a bogus magnitude.
    if valued and value is None:
        print(f"WARNING: keyword '{display}' needs a value but none was given in "
              f"'{ability}' — reminder blanked", file=sys.stderr)
        return display.upper(), ""
    if not valued and value is not None:
        print(f"WARNING: keyword '{display}' takes no value but '{ability}' "
              f"supplies one — value ignored", file=sys.stderr)
        return display.upper(), reminder
    reminder = re.sub(r"\bX\b", value, reminder) if value else reminder
    label = f"{display} {value}" if value else display
    return label.upper(), reminder


def parse_card(row, index):
    def stat(v):
        return v.strip() if v and v.strip() else DEFAULT_STAT

    def split(field):
        return [x.strip() for x in row.get(field, "").split(";") if x.strip()]

    actions = []
    for a in split("actions"):
        if a.count(":") < 2:
            print(f"WARNING: {row.get('id')}: action '{a}' is not name:ap:effect "
                  f"— skipping", file=sys.stderr)
            continue
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
    text("Cost Value", 668, 22, 60, 36, card["cost"], SG, "28", "700", C["coin_text"],
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
    text("Footer Rarity", 26, 1019, 300, 14,
         f"{RARITY_GEM.get(rarity, '◆')} {rarity.upper()}", JB, "9", "700",
         C["lime"], ls=1.8)
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
# Locations (square 750x750; compass edges, VP coin, mission/passive/action)
# ---------------------------------------------------------------------------

def parse_location(row, index):
    def split(field):
        return [x.strip() for x in row.get(field, "").split(";") if x.strip()]

    reqs, vp = [], None
    mission = row.get("mission", "").strip()
    if mission:
        req_part, _, vp_part = mission.partition(">")
        vp = vp_part.strip() or None
        for r in req_part.split(";"):
            r = r.strip()
            if r:
                key, sep, n = r.rpartition("_")
                if sep and n.isdigit():
                    # stat thresholds (strength_15 = combined stat >= 15) render
                    # "STRENGTH ≥15"; attribute/unit counts (knowledge_2, units_3)
                    # render "KNOWLEDGE ×2".
                    op = "≥" if key.lower() in STAT_REQ_KEYS else "×"
                    reqs.append((key.upper(), f"{op}{n}"))
                else:               # no numeric suffix -> use the whole token
                    reqs.append((r.upper(), ""))

    actions = []
    for a in split("actions"):
        name, _, rest = a.partition(":")
        ap, _, effect = rest.partition(":")
        actions.append({"name": name.strip(), "ap": ap.strip(), "effect": effect.strip()})

    return {
        "id": row["id"],
        "name": row["name"],
        "number": f"L{index + 1:02d}",
        "set": row.get("set", ""),
        "rarity": (row.get("rarity") or "common").lower(),
        "location_type": (row.get("location_type") or "").strip(),
        "reqs": reqs,
        "vp": vp,
        "passive": (row.get("passive") or "").strip(),
        "edges": [e.strip().upper() for e in row.get("edges", "").split(";") if e.strip()],
        "actions": actions,
        "text": (row.get("text") or "").strip(),
        "flavor": (row.get("flavor") or "").strip(),
    }


# footer-glass layout
GL_X, GL_W = 40, 670
GL_L, GL_R = 59, 691           # content left / right
GL_PAD_T, GL_PAD_B, GL_GAP = 15, 15, 11
GL_LINE_H = 20                 # rarity/set-id line
LOC_BODY_FS, LOC_BODY_LH = 14, 20


def _draw_edge(rect, text, side, blocked):
    """One compass edge. Blocked = red bar + plate; open = grey line with a gate gap."""
    red, grey = C["edge_blocked"], C["edge_open"]
    horiz = side in ("N", "S")
    pos = 9 if side in ("N", "W") else 741   # centerline, 9px inset

    if horiz:
        if blocked:
            rect(f"Edge {side}", 9, pos - 7, 732, 14, fills=_fill(red))
            py = -0.5 if side == "N" else 731.5
            rect(f"Edge {side} Plate", 360, py, 30, 19, fills=_fill(red), r1=2, r2=2, r3=2, r4=2)
            text(f"Edge {side} L", 360, pos - 9, 30, 16, side, JB, "13", "700",
                 C["card_bg"], align="center", ls=1)
        else:
            rect(f"Edge {side} A", 9, pos - 1, 296, 2, fills=_fill(grey, 0.4))
            rect(f"Edge {side} B", 445, pos - 1, 296, 2, fills=_fill(grey, 0.4))
            rect(f"Edge {side} T1", 304, pos - 7, 2, 14, fills=_fill(grey, 0.4))
            rect(f"Edge {side} T2", 444, pos - 7, 2, 14, fills=_fill(grey, 0.4))
            text(f"Edge {side} L", 360, pos - 9, 30, 16, side, JB, "13", "700",
                 grey, align="center", ls=1)
    else:
        if blocked:
            rect(f"Edge {side}", pos - 7, 9, 14, 732, fills=_fill(red))
            rect(f"Edge {side} Plate", pos - 9, 360, 19, 30, fills=_fill(red), r1=2, r2=2, r3=2, r4=2)
            text(f"Edge {side} L", pos - 15, 366, 30, 16, side, JB, "13", "700",
                 C["card_bg"], align="center", ls=1)
        else:
            rect(f"Edge {side} A", pos - 1, 9, 2, 296, fills=_fill(grey, 0.4))
            rect(f"Edge {side} B", pos - 1, 445, 2, 296, fills=_fill(grey, 0.4))
            rect(f"Edge {side} T1", pos - 7, 304, 14, 2, fills=_fill(grey, 0.4))
            rect(f"Edge {side} T2", pos - 7, 444, 14, 2, fills=_fill(grey, 0.4))
            text(f"Edge {side} L", pos - 15, 366, 30, 16, side, JB, "13", "700",
                 grey, align="center", ls=1)


def _loc_rows(card):
    """Footer rows [(kind, data, height)] in order: mission, passive, action."""
    rows = []
    if card["reqs"]:
        rows.append(("mission", card, 31))
    if card["passive"]:
        n = max(1, len(_wrap_lines(card["passive"], 560, LOC_BODY_FS, CHAR_ADVANCE)))
        rows.append(("passive", card["passive"], n * LOC_BODY_LH))
    if card["actions"]:
        a = card["actions"][0]
        pill = f"{a['name'].upper()} · {a['ap']} AP"
        pill_w = int(len(pill) * 10 * 0.62) + 14
        body = card["text"]
        n = max(1, len(_wrap_lines(body, GL_R - GL_L - pill_w - 12, LOC_BODY_FS, CHAR_ADVANCE))) if body else 1
        rows.append(("action", (pill, pill_w, body), n * LOC_BODY_LH))
    return rows


def build_location_shapes(page_id, frame_id, card, glossary):
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

    # 1. Card background (hatch texture dropped for v1)
    rect("Card Background", 0, 0, 750, 750, fills=_fill(C["card_bg"]),
         r1=14, r2=14, r3=14, r4=14)

    # 2. Art placeholder label (type-glyph watermark dropped — icon asset, #204)
    text("Art Label", 285, 414, 180, 16, "LOCATION ART", JB, "10", "400",
         C["muted"], align="center", ls=3)

    # 3. Compass edges (blocked from `edges`; the rest open)
    for side in ("N", "S", "W", "E"):
        _draw_edge(rect, text, side, side in card["edges"])

    # 4. Header: name/type box + (mission) VP box
    rect("Name Box", 40, 34, 572, 86, fills=_fill(C["glass"], 0.78),
         r1=10, r2=10, r3=10, r4=10, strokes=_stroke(C["hairline"], 1))
    text("Card Name", 59, 46, 534, 40, card["name"], SG, "30", "700", C["text"], ls=-0.3)
    if card["location_type"]:
        # icon slot deferred (#204); label sits at the content edge for now
        text("Type Label", 59, 86, 300, 16, card["location_type"].upper(), JB,
             "11", "600", C["muted"], ls=2.4)

    if card["vp"]:
        rect("VP Box", 624, 34, 86, 86, fills=_fill(C["glass"], 0.78),
             r1=10, r2=10, r3=10, r4=10, strokes=_stroke(C["hairline"], 1))
        coin = make_radial_gradient_fill(0.35, 0.3, 0.35, 1.1, 1, [
            {"color": "#ffe9a8", "offset": 0, "opacity": 1},
            {"color": "#f4c24a", "offset": 0.55, "opacity": 1},
            {"color": "#a3761a", "offset": 1, "opacity": 1}])
        circle("VP Coin", 635, 45, 64, 64, [coin], strokes=_stroke(C["coin_border"], 2),
               shadow=[make_shadow("#f4c24a", 16, 0.3)])
        circle("VP Ring", 638, 48, 58, 58, [], strokes=_stroke("#ffe9a8", 3, 0.33))
        text("VP Number", 635, 56, 64, 34, card["vp"], SG, "26", "700", C["coin_text"],
             align="center")
        text("VP Label", 635, 87, 64, 12, "VP", JB, "8", "700", C["coin_text"],
             align="center", ls=1.8)

    # 5. Footer glass — content-driven height, bottom-anchored
    rows = _loc_rows(card)
    content_h = sum(h for _, _, h in rows) + GL_GAP * max(0, len(rows) - 1)
    total_h = GL_PAD_T + content_h + GL_GAP + GL_LINE_H + GL_PAD_B
    glass_y = 750 - 34 - total_h
    rect("Footer Glass", GL_X, glass_y, GL_W, total_h, fills=_fill(C["glass"], 0.78),
         r1=10, r2=10, r3=10, r4=10, strokes=_stroke(C["hairline"], 1))

    cursor = glass_y + GL_PAD_T
    for kind, data, h in rows:
        if kind == "mission":
            text("Mission Label", GL_L, cursor + 8, 60, 14, "MISSION", JB, "10",
                 "700", C["lime"], ls=2.4)
            cx = GL_L + 70
            for j, (key, n) in enumerate(data["reqs"]):
                label = f"{key} {n}" if n else key
                w = int(len(label) * 12 * 0.62) + 20
                rect(f"Req Chip {j}", cx, cursor, w, 30, fills=_fill("#000000", 0.25),
                     r1=4, r2=4, r3=4, r4=4, strokes=_stroke(C["lime"], 1.5))
                text(f"Req {j}", cx, cursor + 7, w, 16, label, JB, "12", "700",
                     C["text"], align="center", ls=1.2)
                cx += w + 8
            if data["vp"]:
                text("Mission VP", cx + 4, cursor + 8, 130, 14, f"→ {data['vp']} VP",
                     JB, "11", "700", C["muted"], ls=1.2)
        elif kind == "passive":
            text("Passive Label", GL_L, cursor, 66, 16, "PASSIVE", JB, "10", "700",
                 C["muted"], ls=2.4)
            text("Passive Body", GL_L + 72, cursor - 2, 560, h, data, SG, "14",
                 "400", C["text"])
        elif kind == "action":
            pill, pill_w, body = data
            rect("Action Pill", GL_L, cursor, pill_w, 17, fills=_fill(C["lime"]),
                 r1=3, r2=3, r3=3, r4=3)
            text("Action Tag", GL_L, cursor + 3, pill_w, 13, pill, JB, "10", "800",
                 C["card_bg"], align="center", ls=1.2)
            if body:
                text("Action Body", GL_L + pill_w + 12, cursor - 2,
                     GL_R - GL_L - pill_w - 12, h, body, SG, "14", "400", C["text"])
        cursor += h + GL_GAP

    # Footer line: divider + rarity + set id
    div_y = glass_y + total_h - GL_PAD_B - GL_LINE_H + 6
    rect("Footer Divider", GL_L, div_y, GL_R - GL_L, 1, fills=_fill(C["hairline"]))
    text("Footer Rarity", GL_L, div_y + 7, 300, 14,
         f"{RARITY_GEM.get(rarity, '◆')} {rarity.upper()}", JB, "9", "700",
         C["lime"], ls=1.8)
    prefix = "MISSION" if card["reqs"] else "LOCATION"
    text("Footer Set", GL_R - 300, div_y + 7, 300, 14,
         f"{prefix} // {card['set'].upper()} · {card['number']}", JB, "9",
         "400", C["muted"], align="right", ls=1.8)

    return ch


# ---------------------------------------------------------------------------
# Item / Event / Policy — portrait 750x1050 "Gate" layout
# ---------------------------------------------------------------------------

def _gold_coin():
    return make_radial_gradient_fill(0.35, 0.3, 0.35, 1.1, 1, [
        {"color": "#ffe9a8", "offset": 0, "opacity": 1},
        {"color": "#f4c24a", "offset": 0.55, "opacity": 1},
        {"color": "#a3761a", "offset": 1, "opacity": 1}])


def _parse_actions(row):
    out = []
    for a in [x.strip() for x in row.get("actions", "").split(";") if x.strip()]:
        if a.count(":") < 2:
            print(f"WARNING: {row.get('id')}: action '{a}' is not name:ap:effect "
                  f"— skipping", file=sys.stderr)
            continue
        name, _, rest = a.partition(":")
        ap, _, effect = rest.partition(":")
        out.append({"name": name.strip(), "ap": ap.strip(), "body": effect.strip()})
    return out


def parse_item(row, index):
    return {
        "id": row["id"], "name": row["name"], "number": f"I{index + 1:02d}",
        "set": row.get("set", ""), "rarity": (row.get("rarity") or "common").lower(),
        "type": (row.get("type") or "ITEM").strip(),
        "cost": (row.get("cost") or "").replace("|", " / "),
        "equip": (row.get("equip") or "").strip(),
        "stored": (row.get("stored") or "").strip(),
        "actions": _parse_actions(row), "text": (row.get("text") or "").strip(),
        "flavor": (row.get("flavor") or "").strip(),
    }


def parse_event(row, index):
    timing = (row.get("timing") or "instant").lower().strip()
    if timing not in ("instant", "passive", "trap"):
        print(f"WARNING: {row.get('id')}: unknown timing '{timing}' — rendering "
              f"with default styling and no trigger row", file=sys.stderr)
    return {
        "id": row["id"], "name": row["name"], "number": f"E{index + 1:02d}",
        "set": row.get("set", ""), "rarity": (row.get("rarity") or "common").lower(),
        "timing": timing,
        "duration": (row.get("duration") or "").strip(),
        "trigger": (row.get("trigger") or "").strip(),
        "event_type": (row.get("event_type") or "").strip(),
        "cost": (row.get("cost") or "").replace("|", " / "),
        "attributes": [a.strip() for a in row.get("attributes", "").split(";") if a.strip()],
        "text": (row.get("text") or "").strip(), "flavor": (row.get("flavor") or "").strip(),
    }


def parse_policy(row, index):
    attrs = [a.strip() for a in row.get("attributes", "").split(";") if a.strip()]
    return {
        "id": row["id"], "name": row["name"], "number": f"P{index + 1:02d}",
        "set": row.get("set", ""), "rarity": (row.get("rarity") or "epic").lower(),
        "attribute": attrs[0] if attrs else "",
        "effect": (row.get("effect") or "").strip(),
        "seeding": (row.get("seeding_effect") or "").strip(),
        "actions": _parse_actions(row), "flavor": (row.get("flavor") or "").strip(),
    }


def _mk_closures(page_id, frame_id, ch):
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

    return rect, circle, text


# portrait Gate footer glass
PF_L, PF_R, PF_PAD, PF_LINE = 61, 689, 16, 20


def _portrait_footer(rect, text, rows, gap, flavor, rarity, setid):
    """rows = [(height, render(cursor))]. Draws a bottom-anchored glass box with
    the rows, an optional flavor line, and the divider + rarity + set-id line."""
    flav_h = 20 if flavor else 0
    content = sum(h for h, _ in rows) + gap * max(0, len(rows) - 1)
    total = PF_PAD + content + gap + (flav_h + gap if flavor else 0) + PF_LINE + PF_PAD
    gy = 1050 - 38 - total
    rect("Footer Glass", 40, gy, 670, total, fills=_fill(C["glass"], 0.78),
         r1=10, r2=10, r3=10, r4=10, strokes=_stroke(C["hairline"], 1))
    cur = gy + PF_PAD
    for h, render in rows:
        render(cur)
        cur += h + gap
    if flavor:
        text("Flavor", PF_L, cur, PF_R - PF_L, 20, f'"{flavor}"', SG, "12.5",
             "400", C["muted"], style="italic")
    div_y = gy + total - PF_PAD - PF_LINE + 6
    rect("Footer Divider", PF_L, div_y, PF_R - PF_L, 1, fills=_fill(C["hairline"]))
    text("Footer Rarity", PF_L, div_y + 7, 300, 14,
         f"{RARITY_GEM.get(rarity, '◆')} {rarity.upper()}", JB, "9", "700",
         C["lime"], ls=1.8)
    text("Footer Set", PF_R - 300, div_y + 7, 300, 14, setid, JB, "9", "400",
         C["muted"], align="right", ls=1.8)


def _name_box(rect, text, name, box_h=86):
    rect("Name Box", 40, 38, 574, box_h, fills=_fill(C["glass"], 0.78),
         r1=10, r2=10, r3=10, r4=10, strokes=_stroke(C["hairline"], 1))
    text("Card Name", 59, 50, 536, 40, name, SG, "32", "700", C["text"], ls=-0.32)


def _cost_box(rect, circle, text, cost, box_h=86, coin_cy=80):
    rect("Cost Box", 626, 38, 84, box_h, fills=_fill(C["glass"], 0.78),
         r1=10, r2=10, r3=10, r4=10, strokes=_stroke(C["hairline"], 1))
    circle("Cost Coin", 637, coin_cy - 31, 62, 62, [_gold_coin()],
           strokes=_stroke(C["coin_border"], 2), shadow=[make_shadow("#f4c24a", 16, 0.3)])
    circle("Cost Ring", 640, coin_cy - 28, 56, 56, [], strokes=_stroke("#ffe9a8", 3, 0.33))
    text("Cost Value", 626, coin_cy - 15, 84, 36, cost, SG, "28", "700",
         C["coin_text"], align="center")


def _wrapc(s, w, fs=15):
    return max(1, len(_wrap_lines(s, w, fs, CHAR_ADVANCE)))


def build_item_shapes(page_id, frame_id, card, glossary):
    ch = []
    rect, circle, text = _mk_closures(page_id, frame_id, ch)
    rect("Card Background", 0, 0, 750, 1050, fills=_fill(C["card_bg"]), r1=14, r2=14, r3=14, r4=14)
    text("Art Label", 285, 640, 180, 16, "ITEM ART", JB, "10", "400", C["muted"], align="center", ls=3)
    _name_box(rect, text, card["name"])
    text("Type Label", 59, 94, 260, 14, card["type"].upper().replace(";", " · "),
         JB, "11", "600", C["muted"], ls=2.4)
    _cost_box(rect, circle, text, card["cost"])

    def mode(idx, label, color, body):
        n = _wrapc(body, 560)
        h = max(34, 18 + n * 22)

        def render(cur):
            rect(f"Mode {idx} Box", 61, cur, 34, 34, fills=_fill("#000000", 0.25),
                 r1=8, r2=8, r3=8, r4=8, strokes=_stroke(color, 1.5))
            text(f"Mode {idx} Label", 106, cur, 400, 13, label, JB, "10", "700", color, ls=2.4)
            text(f"Mode {idx} Body", 106, cur + 18, 560, n * 22, body, SG, "15", "400", C["text"])
        return (h, render)

    def action(idx, a):
        pill = f"{a['name'].upper()} · {a['ap']} AP"
        pw = int(len(pill) * 12 * 0.62) + 20
        # item action effects are DSL tokens (unlike policies' prose); the card's
        # human `text` summary covers the item as a whole, so show it once under
        # the first pill and fall back to each later action's own effect token —
        # otherwise a multi-action item would repeat the same summary per pill.
        body = card["text"] if idx == 0 else a["body"]
        n = _wrapc(body, PF_R - PF_L - pw - 12, 16) if body else 1
        h = max(23, n * 24)

        def render(cur):
            rect(f"Act {idx} Pill", 61, cur, pw, 23, fills=_fill(C["lime"]), r1=3, r2=3, r3=3, r4=3)
            text(f"Act {idx} Tag", 61, cur + 5, pw, 15, pill, JB, "12", "800", C["card_bg"],
                 align="center", ls=1.2)
            if body:
                text(f"Act {idx} Body", 61 + pw + 12, cur, PF_R - 61 - pw - 12, n * 24,
                     body, SG, "16", "400", C["text"])
        return (h, render)

    rows = []
    if card["equip"]:
        rows.append(mode(0, "EQUIP — ON A UNIT", C["lime"], card["equip"]))
    if card["stored"]:
        rows.append(mode(1, "STORED — AT A LOCATION", C["muted"], card["stored"]))
    for i, a in enumerate(card["actions"]):
        rows.append(action(i, a))
    setid = (f"ITEM · {card['type'].upper().replace(';', ' · ')} // "
             f"{card['set'].upper()} · {card['number']}")
    _portrait_footer(rect, text, rows, 13, card["flavor"], card["rarity"], setid)
    return ch


def build_event_shapes(page_id, frame_id, card, glossary):
    ch = []
    rect, circle, text = _mk_closures(page_id, frame_id, ch)
    timing = card["timing"]
    accent = {"instant": C["lime"], "passive": C["muted"], "trap": "#ff6b6b"}.get(timing, C["lime"])

    rect("Card Background", 0, 0, 750, 1050, fills=_fill(C["card_bg"]), r1=14, r2=14, r3=14, r4=14)
    rect("Timing Top Edge", 0, 0, 750, 12, fills=_fill(accent))     # hazard stripes -> solid for v1
    text("Art Label", 285, 651, 180, 16, "EVENT ART", JB, "10", "400", C["muted"], align="center", ls=3)
    _name_box(rect, text, card["name"], box_h=98)
    _cost_box(rect, circle, text, card["cost"], box_h=98, coin_cy=87)

    # timing badge
    badge = timing.upper()
    if timing == "passive" and card["duration"]:
        badge = f"PASSIVE · {card['duration']} TURNS"
    bw = int(len(badge) * 11 * 0.62) + 20
    if timing == "trap":
        rect("Timing Badge", 59, 92, bw, 28, fills=[], r1=4, r2=4, r3=4, r4=4, strokes=_stroke(accent, 2))
        text("Timing Label", 59, 96, bw, 18, badge, JB, "11", "800", accent, align="center", ls=2.2)
    else:
        rect("Timing Badge", 59, 92, bw, 28, fills=_fill(accent), r1=4, r2=4, r3=4, r4=4)
        text("Timing Label", 59, 96, bw, 18, badge, JB, "11", "800", C["card_bg"], align="center", ls=2.2)

    rows = []
    if timing == "trap" and card["trigger"]:
        trig = card["trigger"].replace("_", " ").strip().capitalize()
        n = _wrapc(trig, PF_R - 127, 14)
        h = max(16, n * 20)

        def r_trig(cur, _n=n):
            text("Trigger Label", 61, cur, 66, 14, "TRIGGER", JB, "10", "700", accent, ls=2.2)
            text("Trigger Body", 127, cur - 2, PF_R - 127, _n * 20, trig, SG, "14", "400",
                 C["text"], style="italic")
        rows.append((h, r_trig))
    if card["text"]:
        n = _wrapc(card["text"], PF_R - PF_L, 16)
        h = n * 25

        def r_rules(cur, _n=n, _h=h):
            text("Rules Text", 61, cur, PF_R - PF_L, _h, card["text"], SG, "16", "400", C["text"])
        rows.append((h, r_rules))
    if card["attributes"]:
        def r_attrs(cur):
            cx = 61
            for j, at in enumerate(card["attributes"]):
                w = int(len(at) * 11 * 0.62) + 24
                rect(f"Attr Chip {j}", cx, cur, w, 27, fills=_fill("#000000", 0.25),
                     r1=4, r2=4, r3=4, r4=4, strokes=_stroke(C["lime"], 1, 0.4))
                text(f"Attr {j}", cx, cur + 6, w, 15, at.upper(), JB, "11", "600",
                     C["text"], align="center", ls=1.6)
                cx += w + 8
        rows.append((27, r_attrs))

    setid = f"EVENT · {timing.upper()} // {card['set'].upper()} · {card['number']}"
    _portrait_footer(rect, text, rows, 10, card["flavor"], card["rarity"], setid)
    return ch


def build_policy_shapes(page_id, frame_id, card, glossary):
    ch = []
    rect, circle, text = _mk_closures(page_id, frame_id, ch)
    rect("Card Background", 0, 0, 750, 1050, fills=_fill(C["card_bg"]), r1=14, r2=14, r3=14, r4=14)
    text("Art Label", 285, 609, 180, 16, "POLICY ART", JB, "11", "400", C["muted"], align="center", ls=3)
    _name_box(rect, text, card["name"], box_h=87)
    subtitle = "POLICY" + (f" · {card['attribute'].upper()}" if card["attribute"] else "")
    text("Subtitle", 59, 94, 538, 16, subtitle, JB, "13", "600", C["muted"], ls=3.4)

    # attribute badge (no cost coin on policies)
    rect("Attr Badge Box", 628, 38, 82, 87, fills=_fill(C["glass"], 0.78),
         r1=10, r2=10, r3=10, r4=10, strokes=_stroke(C["hairline"], 1))
    circle("Attr Badge", 639, 51, 60, 60, [_fill("#000000", 0.3)[0]], strokes=_stroke(C["lime"], 2))
    text("Attr Badge Label", 628, 70, 82, 18,
         (card["attribute"].upper() if card["attribute"] else "ANY"), JB, "9", "700",
         C["lime"], align="center", ls=1.4)

    def labeled(idx, label, color, body):
        n = _wrapc(body, 513, 18)
        h = max(20, n * 27)

        def render(cur):
            text(f"LB {idx} Label", 61, cur + 3, 104, 18, label, JB, "12", "700", color, ls=2.2)
            text(f"LB {idx} Body", 176, cur, 513, n * 27, body, SG, "18", "400", C["text"])
        return (h, render)

    def action(idx, a):
        pill = f"{a['name'].upper()} · {a['ap']} AP"
        pw = int(len(pill) * 12 * 0.62) + 20
        bx = 61 + pw + 12               # body follows the pill, not a fixed x
        n = _wrapc(a["body"], PF_R - bx, 17) if a["body"] else 1
        h = max(24, n * 25)

        def render(cur):
            rect(f"PAct {idx} Pill", 61, cur, pw, 24, fills=_fill(C["lime"]), r1=3, r2=3, r3=3, r4=3)
            text(f"PAct {idx} Tag", 61, cur + 5, pw, 15, pill, JB, "12", "800", C["card_bg"],
                 align="center", ls=1.2)
            if a["body"]:
                text(f"PAct {idx} Body", bx, cur, PF_R - bx, n * 25, a["body"], SG, "17",
                     "400", C["text"])
        return (h, render)

    rows = []
    if card["effect"]:
        rows.append(labeled(0, "DOCTRINE", C["lime"], card["effect"]))
    if card["seeding"]:
        rows.append(labeled(1, "SEEDING", C["muted"], card["seeding"]))
    for i, a in enumerate(card["actions"]):
        rows.append(action(i, a))
    setid = f"POLICY // {card['set'].upper()} · {card['number']}"
    _portrait_footer(rect, text, rows, 12, card["flavor"], card["rarity"], setid)
    return ch


# ---------------------------------------------------------------------------
# Card-type dispatch
# ---------------------------------------------------------------------------

TYPES = {
    "unit":     {"frame": "Unit Card MT", "w": 750, "h": 1050,
                 "parse": parse_card, "build": build_shapes},
    "location": {"frame": "Location Card MT", "w": 750, "h": 750,
                 "parse": parse_location, "build": build_location_shapes},
    "item":     {"frame": "Item Card MT", "w": 750, "h": 1050,
                 "parse": parse_item, "build": build_item_shapes},
    "event":    {"frame": "Event Card MT", "w": 750, "h": 1050,
                 "parse": parse_event, "build": build_event_shapes},
    "policy":   {"frame": "Policy Card MT", "w": 750, "h": 1050,
                 "parse": parse_policy, "build": build_policy_shapes},
}
FILENAME_TYPE = {"units": "unit", "locations": "location", "items": "item",
                 "events": "event", "policies": "policy"}


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
        body = exc.read().decode("utf-8", errors="replace")
        print(f"ERROR {exc.code} from get-file: {body[:400]}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as exc:
        print(f"Connection error reaching get-file: {exc.reason}\n"
              f"Is Penpot running? (python3 design/preflight.py)", file=sys.stderr)
        sys.exit(1)


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
    # write atomically so an interrupted write can't truncate the credentials file
    tmp = env_path + ".tmp"
    with open(tmp, "w") as f:
        f.writelines(lines)
    os.replace(tmp, env_path)


def _delete_frame_changes(objects, page_id, frame_name):
    changes = []
    for oid, obj in objects.items():
        if obj.get("name") == frame_name and obj.get("type") == "frame":
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

    stem = os.path.splitext(os.path.basename(csv_path))[0]
    ctype = FILENAME_TYPE.get(stem)
    if not ctype:
        print(f"ERROR: cannot detect card type from '{stem}.csv' "
              f"(expected one of {list(FILENAME_TYPE)})", file=sys.stderr)
        sys.exit(1)
    cfg = TYPES[ctype]

    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    print(f"Loaded {len(rows)} {ctype}s from {csv_path}")
    if rows:
        missing_cols = {"id", "name"} - set(rows[0])
        if missing_cols:
            print(f"ERROR: {csv_path} is missing required column(s): "
                  f"{', '.join(sorted(missing_cols))}", file=sys.stderr)
            sys.exit(1)

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
        if not (row.get("id") or "").strip() or not (row.get("name") or "").strip():
            print(f"ERROR: row {i + 1} of {csv_path} has an empty id or name — "
                  f"a blank/short CSV row would silently collide or vanish on "
                  f"export", file=sys.stderr)
            sys.exit(1)
        card = cfg["parse"](row, i)
        try:
            file_data = client.get_file(file_id)
            if not page_id:
                pages = file_data["data"].get("pages") or []
                if not pages:
                    print("ERROR: Penpot file has no pages", file=sys.stderr)
                    sys.exit(1)
                page_id = pages[0]
            objects = client.get_page_objects(file_data, page_id)
            root_id = file_data["data"]["pagesIndex"][page_id].get("id")
            if not root_id:
                print(f"ERROR: page {page_id} has no root id", file=sys.stderr)
                sys.exit(1)

            changes = _delete_frame_changes(objects, page_id, cfg["frame"])
            frame_id, frame_change = make_frame(cfg["frame"], 0, 0, cfg["w"], cfg["h"],
                                                page_id, root_id, root_id,
                                                fills=[{"fill-color": "#0a1220", "fill-opacity": 0}])
            changes.append(frame_change)
            changes.extend(cfg["build"](page_id, frame_id, card, glossary))
            client.update_file(file_id, changes, file_data["revn"], file_data.get("vern", 0))

            data = client.export_png(file_id, page_id, frame_id)
            if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 1000:
                print(f"ERROR: export for '{card['id']}' is not a valid PNG "
                      f"({len(data)} bytes) — aborting", file=sys.stderr)
                sys.exit(1)

            if not card.get("set"):
                print(f"  WARNING: {card['id']} has no set — writing to exports/unknown/",
                      file=sys.stderr)
            # exports/<set>/<type>-<id>.png — one folder per set, type-prefixed
            # filenames so cards group by type when the folder is sorted.
            set_dir = os.path.join(out_dir, card.get("set") or "unknown")
            os.makedirs(set_dir, exist_ok=True)
            out_path = os.path.join(set_dir, f"{ctype}-{card['id']}.png")
            with open(out_path, "wb") as fout:
                fout.write(data)
        except (Exception, SystemExit):
            print(f"  ...while rendering card '{card['id']}' ({i + 1}/{len(rows)})",
                  file=sys.stderr)
            raise
        print(f"[{i + 1}/{len(rows)}] {card['name']} -> "
              f"{os.path.relpath(out_path, out_dir)} ({len(data)} bytes)")

    print(f"\nDone. {len(rows)} {ctype} PNGs in {out_dir}")


if __name__ == "__main__":
    main()
