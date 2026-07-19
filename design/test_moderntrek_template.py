#!/usr/bin/env python3
"""Smoke tests for the keyword consumer in moderntrek-template.py (#194).

The renderer is Python while the rest of the suite is bun/TS, so these run
standalone:  python3 design/test_moderntrek_template.py  (exit 0 = pass).

Covers load_keyword_vocab's degradation paths (missing / non-JSON / wrong-shape /
valid) and keyword_reminder's structural pill labels for the family grammar +
standalones — the branches that would otherwise ship unverified.
"""

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)  # so the module's `from penpot import ...` resolves

_spec = importlib.util.spec_from_file_location(
    "moderntrek_template", os.path.join(SCRIPT_DIR, "moderntrek-template.py"))
mt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mt)

# build/keywords.json is a JSON array of {name, cardTypes, params, reminder}.
# Mirrors the real artifact shape (engine/src/keywords.ts) for the keywords these
# tests exercise; compose_reminder binds a token's positional args to param
# `name`/`kind` and substitutes into `reminder`.
_FAMILY_PARAMS = [
    {"name": "magnitude", "kind": "signedMagnitude"},
    {"name": "stat", "kind": "statScope"},
    {"name": "context", "kind": "context"},
    {"name": "role", "kind": "role", "optional": True},
]
VOCAB_JSON = [
    {"name": "Leader", "cardTypes": ["unit"], "params": _FAMILY_PARAMS,
     "reminder": "Friendly units at this location get {magnitude} to {stat} {context}{role}."},
    {"name": "Aura", "cardTypes": ["location"], "params": _FAMILY_PARAMS,
     "reminder": "Every unit at this location — friend or foe — gets {magnitude} to {stat} {context}{role}."},
    {"name": "Untouchable", "cardTypes": ["unit"], "params": [{"name": "stat", "kind": "stat"}],
     "reminder": "Cannot be targeted by an Attack while this unit's {stat} exceeds the attacker's {stat}."},
    {"name": "Berserker", "cardTypes": ["unit"], "params": [],
     "reminder": "When this unit wins combat and would injure the loser, it injures itself and kills the loser instead."},
    {"name": "Squire", "cardTypes": ["unit"],
     "params": [{"name": "amount", "kind": "magnitude", "optional": True, "default": 1}],
     "reminder": "Your Equip and Unequip actions cost {amount} less AP."},
    {"name": "Flying", "cardTypes": ["item"], "params": [],
     "reminder": "While equipped, this unit ignores blocked edges when moving."},
]
VOCAB = {k["name"]: k for k in VOCAB_JSON}

_failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        _failures.append(name)


@contextlib.contextmanager
def _tmp_json(obj_or_text):
    """Write a temp file (obj → JSON, str → raw) and yield its path."""
    fd, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(obj_or_text if isinstance(obj_or_text, str) else json.dumps(obj_or_text))
        yield path
    finally:
        os.remove(path)


def _quiet(fn, *args):
    """Call fn, swallowing stderr; return (result, stderr_text)."""
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        result = fn(*args)
    return result, buf.getvalue()


def test_load_keyword_vocab():
    print("load_keyword_vocab:")
    res, err = _quiet(mt.load_keyword_vocab, os.path.join(SCRIPT_DIR, "does-not-exist.json"))
    check("missing file → {}", res == {})
    check("missing file → warns", "not found" in err.lower())

    with _tmp_json(VOCAB_JSON) as p:
        res, _ = _quiet(mt.load_keyword_vocab, p)
        check("valid array → name-keyed dict", isinstance(res, dict) and "Leader" in res and "Aura" in res)

    with _tmp_json({"not": "an array"}) as p:
        res, err = _quiet(mt.load_keyword_vocab, p)
        check("non-array JSON → {}", res == {})
        check("non-array JSON → warns", "not a json array" in err.lower())

    with _tmp_json("{ not json ") as p:
        res, err = _quiet(mt.load_keyword_vocab, p)
        check("unreadable JSON → {}", res == {})
        check("unreadable JSON → warns", "unreadable" in err.lower())

    # Per-entry malformed: garbage / name-less entries are skipped WITH a warning,
    # not silently dropped.
    with _tmp_json([{"name": "Leader", "cardTypes": ["unit"]}, "garbage", {"cardTypes": ["unit"]}]) as p:
        res, err = _quiet(mt.load_keyword_vocab, p)
        check("malformed entries → good one survives", res == {"Leader": {"name": "Leader", "cardTypes": ["unit"]}})
        check("malformed entries → warns", "malformed" in err.lower())

    # A non-string name must not crash (unhashable dict key) — skipped + warned.
    with _tmp_json([{"name": ["x"], "cardTypes": ["unit"]}, {"name": "Aura", "cardTypes": ["location"]}]) as p:
        res, err = _quiet(mt.load_keyword_vocab, p)
        check("non-string name → skipped, no crash", res == {"Aura": {"name": "Aura", "cardTypes": ["location"]}})


def test_keyword_reminder():
    print("keyword_reminder:")
    (label, reminder), err = _quiet(mt.keyword_reminder, "Leader:+1:all:combat", VOCAB)
    check("family token → name + primary value pill", label == "LEADER +1")
    check("family token → composed prose reminder",
          reminder == "Friendly units at this location get +1 to all stats in combat.")
    check("governed keyword in a populated vocab → no warning", err == "")

    # Pill shows only the magnitude value; stat/context/role live in the reminder.
    label, _ = mt.keyword_reminder("Aura:-1:all:combat", VOCAB)
    check("family pill drops stat/context, keeps signed magnitude", label == "AURA -1")

    # Specific stat + mission context + role clause all format through.
    _, reminder = mt.keyword_reminder("Leader:+1:strength:mission:def", VOCAB)
    check("family with role → mission/stat/role formatted",
          reminder == "Friendly units at this location get +1 to strength on missions when defending.")

    label, reminder = mt.keyword_reminder("Untouchable:charisma", VOCAB)
    check("stat-param standalone → name-only pill (stat is not a value)",
          label == "UNTOUCHABLE")
    check("parameterised standalone → reminder repeats the stat",
          reminder == "Cannot be targeted by an Attack while this unit's charisma exceeds the attacker's charisma.")

    label, reminder = mt.keyword_reminder("Berserker", VOCAB)
    check("value-less standalone → label", label == "BERSERKER")
    check("value-less standalone → static reminder",
          reminder == "When this unit wins combat and would injure the loser, it injures itself and kills the loser instead.")

    # Omitted optional param falls back to its declared default (Squire → 1 AP).
    label, reminder = mt.keyword_reminder("Squire", VOCAB)
    check("bare optional-magnitude → name-only pill", label == "SQUIRE")
    check("omitted optional param → default substituted",
          reminder == "Your Equip and Unequip actions cost 1 less AP.")
    label, _ = mt.keyword_reminder("Squire:2", VOCAB)
    check("optional-magnitude with value → name + value pill", label == "SQUIRE 2")

    # A degraded/empty vocab still renders the pill but composes no reminder.
    _, reminder = mt.keyword_reminder("Leader:+1:all:combat", {})
    check("empty vocab → blank reminder, pill still renders", reminder == "")

    # Degenerate tokens: no crash, sensible label, clear signal on an empty name.
    label, _ = mt.keyword_reminder("Leader", VOCAB)
    check("family name with no params → label", label == "LEADER")
    label, _ = mt.keyword_reminder("Leader:", VOCAB)
    check("trailing colon → no trailing space in label", label == "LEADER")
    (label, _), err = _quiet(mt.keyword_reminder, ":", VOCAB)
    check("empty-name token → warns", "empty name" in err.lower())

    # Unknown name (not in vocab) → warns but still renders verbatim.
    (label, reminder), err = _quiet(mt.keyword_reminder, "Mystery:9", VOCAB)
    check("unknown keyword → verbatim label", label == "MYSTERY 9")
    check("unknown keyword → warns", "not in the governed vocab" in err.lower())

    # Empty vocab (degraded load) → no warning, still renders.
    (label, _), err = _quiet(mt.keyword_reminder, "Leader:+1:all:combat", {})
    check("empty vocab → renders label", label == "LEADER +1 ALL COMBAT")
    check("empty vocab → no warning", err == "")


def test_passives_and_blocks():
    print("passives + blocks:")

    # parse_card splits the `passives` column into {name, effect} on the first colon.
    row = {"id": "genghis-khan", "name": "Genghis Khan",
           "actions": "conquer:3:raze(location)", "text": "Raze a location.",
           "passives": "Horselord:Your Equip actions involving a Mount cost 0 AP."}
    card = mt.parse_card(row, 0)
    check("parse_card → named passive parsed",
          card["passives"] == [{"name": "Horselord",
                                "effect": "Your Equip actions involving a Mount cost 0 AP."}])

    card2, err = _quiet(mt.parse_card,
                        {"id": "x", "name": "X", "passives": "NoColonHere"}, 0)
    check("parse_card → colon-less passive skipped", card2["passives"] == [])
    check("parse_card → colon-less passive warns", "is not name:effect" in err.lower())

    # Whitespace-only name or effect drops too, matching the TS build parser.
    card3, err = _quiet(mt.parse_card,
                        {"id": "z", "name": "Z", "passives": "Name:   ;   :effect"}, 0)
    check("parse_card → whitespace-only name/effect skipped", card3["passives"] == [])
    check("parse_card → whitespace-only passive warns", "is not name:effect" in err.lower())

    # _blocks_for: a single action carries the text; named passives get their own
    # blocks; leftover text with no single action falls back to an unnamed passive.
    blocks = mt._blocks_for({"actions": [{"name": "conquer", "ap": "3"}],
                             "passives": [{"name": "Horselord", "effect": "Mount equips free."}],
                             "text": "Raze a location."})
    check("action + passive → two blocks", len(blocks) == 2)
    check("action block carries text",
          blocks[0] == {"kind": "action", "name": "conquer", "ap": "3", "body": "Raze a location."})
    check("named passive block",
          blocks[1] == {"kind": "passive", "name": "Horselord", "body": "Mount equips free."})

    only_passive = mt._blocks_for({"actions": [], "passives": [{"name": "Galvanism", "effect": "First event is free."}], "text": ""})
    check("action-less + named passive → single named passive block",
          only_passive == [{"kind": "passive", "name": "Galvanism", "body": "First event is free."}])

    fallback = mt._blocks_for({"actions": [], "passives": [], "text": "Some loose prose."})
    check("action-less loose text → unnamed passive fallback",
          fallback == [{"kind": "passive", "name": None, "body": "Some loose prose."}])

    multi = mt._blocks_for({"actions": [{"name": "a", "ap": "1"}, {"name": "b", "ap": "2"}],
                            "passives": [], "text": "Trailing note."})
    check("multi-action → empty action bodies + unnamed passive for trailing text",
          [b["kind"] for b in multi] == ["action", "action", "passive"] and multi[2]["name"] is None)

    # Full combination: ≥2 actions AND named passives AND trailing text.
    # Order must be actions → named passives → unnamed trailing-text passive.
    combo = mt._blocks_for({
        "actions": [{"name": "a", "ap": "1"}, {"name": "b", "ap": "2"}],
        "passives": [{"name": "Horselord", "effect": "Free mounts."}],
        "text": "Trailing note."})
    check("multi-action + named passive + trailing text → block order",
          [b["kind"] for b in combo] == ["action", "action", "passive", "passive"])
    check("multi-action combo → named passive precedes trailing-text passive",
          combo[2]["name"] == "Horselord" and combo[3]["name"] is None)


def test_nonunit_keywords():
    print("non-unit keywords:")
    # parse_location / parse_item now carry the keywords column so their builders
    # can render pills (Aura on locations, Flying/Heavy/Lightweight on items).
    loc = mt.parse_location({"id": "x", "name": "X", "keywords": "Aura:-1:all:combat"}, 0)
    check("parse_location carries keywords", loc["keywords"] == ["Aura:-1:all:combat"])
    item = mt.parse_item({"id": "y", "name": "Y", "keywords": "Flying;Heavy"}, 0)
    check("parse_item carries keywords", item["keywords"] == ["Flying", "Heavy"])

    # _kw_reminder_lines: no reminder → 1; a long reminder actually wraps to ≥2
    # lines in the pill's right-hand column (max(1, …) makes >= 1 vacuous).
    check("kw lines: empty reminder → 1", mt._kw_reminder_lines("FLYING", "", 26, 716, 14) == 1)
    n = mt._kw_reminder_lines(
        "AURA -1",
        "Every unit at this location — friend or foe — gets -1 to all stats in combat.",
        59, 691, 14)
    check("kw lines: long reminder wraps to >= 2 lines", n >= 2)


def test_event_type_chip():
    """The governed `event_type` (Catastrophe/Prosperity) renders as its own chip
    beside the timing badge — a rules-faithful category that was previously parsed
    but never drawn (#202)."""
    print("event_type chip:")
    typed = mt.parse_event({"id": "e", "name": "E", "timing": "instant",
                            "event_type": "Catastrophe"}, 0)
    ch, _ = _quiet(mt.build_event_shapes, "pg", "fr", typed, {})
    check("event_type parsed", typed["event_type"] == "Catastrophe")
    check("event_type chip drawn, uppercased",
          _rendered_text(ch, "Event Type Label") == "CATASTROPHE")
    # The chip's contract is positional: it sits to the RIGHT of the timing badge,
    # not overlapping it (renderer: ex = 59 + bw + 10). The text-content check above
    # would still pass on a mis-positioned chip, so assert the geometry too.
    tb = _shape_bounds(ch, "Timing Badge")
    et = _shape_bounds(ch, "Event Type Badge")
    check("event_type chip sits right of the timing badge, no overlap",
          tb is not None and et is not None and et[0] >= tb[0] + tb[2])
    # The chip label is a single word, so it never wraps (`_wrap_lines` only breaks
    # on spaces) — the real invariant is that the rendered text fits inside the chip
    # box rather than spilling past its outline. `_line_count == 1` would be vacuous.
    check("CATASTROPHE chip text fits inside its box",
          _text_width(ch, "Event Type Label") <= et[2])

    untyped = mt.parse_event({"id": "e2", "name": "E2", "timing": "instant"}, 0)
    ch2, _ = _quiet(mt.build_event_shapes, "pg", "fr", untyped, {})
    # Rename-safe only because the positive assertion above anchors the
    # "Event Type Label" name and would fail loudly if the shape were renamed.
    check("no event_type → no chip drawn",
          _rendered_text(ch2, "Event Type Label") is None)

    # The other half of #202: the timing-badge width fix. A passive event with a
    # duration renders the long "PASSIVE · N TURNS" badge, which must stay on one
    # line. Assert the position-data line count — NOT _rendered_text, which joins
    # lines with a space and so reads identically whether or not the badge wrapped.
    passive = mt.parse_event({"id": "e3", "name": "E3", "timing": "passive",
                              "duration": "3"}, 0)
    ch3, _ = _quiet(mt.build_event_shapes, "pg", "fr", passive, {})
    check("PASSIVE · N TURNS badge stays on one line",
          _line_count(ch3, "Timing Label") == 1)

    # Both halves together: a wide passive badge AND a chip. The chip's x offset
    # depends on the badge width, so this is where the two features interact.
    combo = mt.parse_event({"id": "e4", "name": "E4", "timing": "passive",
                            "duration": "3", "event_type": "Prosperity"}, 0)
    ch4, _ = _quiet(mt.build_event_shapes, "pg", "fr", combo, {})
    check("combined: passive badge one line", _line_count(ch4, "Timing Label") == 1)
    ctb = _shape_bounds(ch4, "Timing Badge")
    cet = _shape_bounds(ch4, "Event Type Badge")
    check("combined: PROSPERITY chip text fits inside its box",
          _text_width(ch4, "Event Type Label") <= cet[2])
    check("combined: chip clears the wide passive badge",
          ctb is not None and cet is not None and cet[0] >= ctb[0] + ctb[2])


def _real_vocab():
    """Load the real build/keywords.json (building it if absent) as a name-keyed dict."""
    root = os.path.join(SCRIPT_DIR, "..")
    artifact = os.path.join(root, "library", "build", "keywords.json")
    if not os.path.exists(artifact):
        subprocess.run(["bun", "library/build.ts"], cwd=root, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return mt.load_keyword_vocab(artifact)


def test_real_vocab_reminders():
    """Compose reminders from the REAL shipped keywords.json, not the mock VOCAB.

    The other tests assert against the hand-written VOCAB_JSON, so a change to a
    real reminder template in engine/src/keywords.ts fails none of them. This
    exercises the actual artifact end-to-end, catching template↔renderer drift."""
    print("real keywords.json integration:")
    vocab = _real_vocab()
    check("real vocab loaded", bool(vocab) and "Leader" in vocab)

    _, r = mt.keyword_reminder("Leader:+1:all:combat", vocab)
    check("real Leader reminder composes",
          r == "Friendly units at this location get +1 to all stats in combat.")
    _, r = mt.keyword_reminder("Squire", vocab)
    check("real Squire omitted-arg → default 1",
          r == "Your Equip and Unequip actions cost 1 less AP.")
    # Patron: a required, unsigned magnitude standalone — never exercised by the mock.
    label, r = mt.keyword_reminder("Patron:2", vocab)
    check("real Patron pill shows the value", label == "PATRON 2")
    check("real Patron reminder composes",
          r == "Cards you buy that share an attribute with this unit cost 2 less gold.")
    _, r = mt.keyword_reminder("Aura:-1:all:combat", vocab)
    check("real Aura reminder composes",
          r == "Every unit at this location — friend or foe — gets -1 to all stats in combat.")


def test_compose_reminder_degradation():
    """The silent-degradation guards in compose_reminder now warn; assert both
    the blank-reminder fallback (never a crash) and the warning."""
    print("compose_reminder degradation:")
    res, err = _quiet(mt.compose_reminder, "Foo:1", {"reminder": "x {a}", "params": ["not-a-dict"]})
    check("non-dict param → blank reminder", res == "")
    check("non-dict param → warns", "malformed param spec" in err.lower())

    res, _ = _quiet(mt.compose_reminder, "Foo:1",
                    {"reminder": "x {a}", "params": [{"name": ["a"], "kind": "magnitude"}]})
    check("non-string param name → blank reminder", res == "")

    res, err = _quiet(mt.compose_reminder, "Foo:1",
                      {"reminder": "needs {missing}", "params": [{"name": "a", "kind": "magnitude"}]})
    check("unbound template placeholder → blank reminder", res == "")
    check("unbound template placeholder → warns", "out of sync" in err.lower())

    check("missing template/params → blank, no crash", mt.compose_reminder("Foo:1", {}) == "")


def test_format_param_edges():
    """_format_param enum-mapping edges: the role 'either' → '' collapse, and the
    unknown-value verbatim passthrough (which now warns)."""
    print("_format_param edges:")
    check("role either → empty clause", mt._format_param("role", "either") == "")
    check("role atk → ' when attacking'", mt._format_param("role", "atk") == " when attacking")
    check("statScope all → 'all stats'", mt._format_param("statScope", "all") == "all stats")

    res, err = _quiet(mt._format_param, "context", "underwater")
    check("unknown enum value → verbatim passthrough", res == "underwater")
    check("unknown enum value → warns", "not a known context" in err.lower())

    res, err = _quiet(mt._format_param, "magnitude", "3")
    check("unmapped kind (magnitude) → verbatim, no warn", res == "3" and err == "")


def test_keyword_pill_row():
    """_keyword_pill_row is the draw function unified across unit/location/item
    builders (#202). Drive it with fake rect/text sinks to pin its returned row
    height and what it draws, without a real Penpot page."""
    print("_keyword_pill_row:")
    calls = []
    fake_rect = lambda *a, **k: calls.append(("rect", a))
    fake_text = lambda *a, **k: calls.append(("text", a))

    h = mt._keyword_pill_row(fake_rect, fake_text, 0, "FLYING", "", 26, 716, 100)
    check("pill row (no reminder) → min height 25", h == 25)
    check("pill row (no reminder) → draws pill + label only",
          [c[0] for c in calls] == ["rect", "text"])

    calls.clear()
    long_r = "Every unit at this location — friend or foe — gets -1 to all stats in combat."
    h2 = mt._keyword_pill_row(fake_rect, fake_text, 1, "AURA -1", long_r, 59, 691, 100)
    n = mt._kw_reminder_lines("AURA -1", long_r, 59, 691, 14)
    check("pill row (reminder) → height == max(25, n*line_h)", h2 == max(25, n * 18))
    check("pill row (reminder) → draws the reminder text",
          any("KW Reminder" in str(a) for _, a in calls))


def test_block_fitting():
    """#10 unit overflow: _fit_block_font shrinks a uniform body size before any
    truncation, and _render_block ellipsises a block that still overflows the
    hard bottom rather than colliding with the flavor / stat ribbon."""
    print("unit block fitting:")
    from penpot import ELLIPSIS

    long_body = "Deal three damage to a chosen enemy unit and draw a card. " * 6
    blocks = [{"kind": "action", "name": "strike", "ap": "2", "body": long_body}]

    # Loose budget keeps the nominal size; a tight one shrinks toward the floor.
    check("loose budget → keeps nominal body size",
          mt._fit_block_font(blocks, 400) == mt.BODY_FS)
    tight = mt._fit_block_font(blocks, 120)
    check("tight budget → shrinks below nominal", tight < mt.BODY_FS)
    check("tight budget → not below the floor", tight >= mt.MIN_FONT_SIZE)
    check("impossible budget → clamps at the floor",
          mt._fit_block_font(blocks, 40) == float(mt.MIN_FONT_SIZE))

    # A block rendered into a tiny space above hard_bottom truncates its body.
    calls = []
    fake_rect = lambda *a, **k: None
    fake_text = lambda *a, **k: calls.append(a)
    mt._render_block(fake_rect, fake_text, 0, blocks[0], 800,
                     body_fs=mt.MIN_FONT_SIZE, hard_bottom=860)
    body_calls = [a for a in calls if "Body" in a[0]]
    check("overflowing block → body still drawn", len(body_calls) == 1)
    check("overflowing block → body truncated with ellipsis",
          _text_arg(body_calls[0], "content").endswith(ELLIPSIS))


# text() positional-arg order (build_shapes' text(name, x, y, w, h, content, …)),
# so tests can read a captured call by role instead of a bare magic index.
_TEXT_ARGS = {"name": 0, "x": 1, "y": 2, "w": 3, "h": 4, "content": 5, "size": 7}


def _text_arg(call, role):
    return call[_TEXT_ARGS[role]]


def _bounds(ch):
    """Yield (name, x, y, w, h) for every shape a builder emitted."""
    for c in ch:
        o = c["obj"]
        yield o["name"], o["x"], o["y"], o["width"], o["height"]


def _rendered_text(ch, name):
    """Concatenated visual text of the first text shape whose name contains `name`
    (reconstructed from its position-data lines), or None if absent."""
    for c in ch:
        o = c["obj"]
        if o.get("type") == "text" and name in o["name"]:
            return " ".join(e["text"] for e in o.get("position-data", []))
    return None


def _line_count(ch, name):
    """Number of laid-out lines (position-data entries) of the first text shape whose
    name contains `name`, or None if absent. Unlike `_rendered_text`, this detects
    wrapping — the join in `_rendered_text` reads identically whether text wrapped."""
    for c in ch:
        o = c["obj"]
        if o.get("type") == "text" and name in o["name"]:
            return len(o.get("position-data", []))
    return None


def _shape_bounds(ch, name):
    """(x, y, w, h) of the first shape whose name contains `name`, or None."""
    for n, x, y, w, h in _bounds(ch):
        if name in n:
            return (x, y, w, h)
    return None


def _text_width(ch, name):
    """Widest rendered line (position-data `width`) of the first text shape whose
    name contains `name`, or None. This is the true rendered advance (CHAR_ADVANCE
    + letter-spacing), so it can be compared against the shape's box width to catch
    a label that spills past its container — which single-word labels do without
    ever wrapping (`_wrap_lines` only breaks on spaces)."""
    for c in ch:
        o = c["obj"]
        if o.get("type") == "text" and name in o["name"]:
            pd = o.get("position-data", [])
            return max((e["width"] for e in pd), default=0)
    return None


def test_overflow_containment():
    """#10 end-to-end: build each card type from deliberately huge text and
    assert no shape escapes the fixed card frame — the whole point of the fit."""
    print("overflow containment (all types):")
    giant = "This card unleashes a devastating cascade of effects on resolution. " * 40
    giant2 = "Every adjacent location suffers compounding penalties each turn. " * 40

    cases = [
        ("unit", 1050, mt.parse_card, {
            "id": "s-u", "name": "Stress Unit", "strength": "5", "cunning": "5",
            "charisma": "5", "text": giant, "passives": "Overload:" + giant2,
            "flavor": giant}),
        ("location", 750, mt.parse_location, {
            "id": "s-l", "name": "Stress Loc", "mission": "strength_15;knowledge_2>3",
            "passive": giant, "actions": "survey:2:scout", "text": giant2}),
        ("item", 1050, mt.parse_item, {
            "id": "s-i", "name": "Stress Item", "type": "WEAPON", "equip": giant,
            "stored": giant2, "text": giant, "actions": "strike:2:deal", "flavor": giant2}),
        ("event", 1050, mt.parse_event, {
            "id": "s-e", "name": "Stress Event", "timing": "trap",
            "trigger": "when an enemy enters " * 20, "text": giant,
            "attributes": "war;trade", "flavor": giant2}),
        ("policy", 1050, mt.parse_policy, {
            "id": "s-p", "name": "Stress Policy", "attributes": "war", "effect": giant,
            "seeding_effect": giant2, "actions": "enact:1:apply", "flavor": giant}),
    ]
    build = {"unit": mt.build_shapes, "location": mt.build_location_shapes,
             "item": mt.build_item_shapes, "event": mt.build_event_shapes,
             "policy": mt.build_policy_shapes}

    # The highest-priority body row that must survive the fit on each type, and the
    # source text it renders — so we assert content is *preserved*, not just that the
    # geometry stays in-frame (a regression dropping ALL text would pass that alone).
    body_probe = {
        # unit has no actions here, so block 0 is the "Overload" passive (giant2).
        "unit": ("Block 0 Body", giant2),
        "location": ("Passive Body", giant),
        "item": ("Mode 0 Body", giant),
        "event": ("Rules Text", giant),
        "policy": ("LB 0 Body", giant),
    }

    for kind, card_h, parse, row in cases:
        card = parse(row, 0)
        ch, _ = _quiet(build[kind], "pg", "fr", card, {})
        # Compass edge labels are fixed decorations placed just outside the frame
        # by design (pre-#10); the fit only governs footer/rules content shapes.
        offenders = [(n, y, h) for n, x, y, w, h in _bounds(ch)
                     if not n.startswith("Edge ")
                     and (y < -0.5 or y + h > card_h + 1.0 or x < -0.5 or x + w > 750 + 1.0)]
        check(f"{kind}: giant text → every shape within the {card_h}px frame",
              not offenders)
        if offenders:
            print(f"      offenders: {offenders[:4]}")

        # Content preservation: the top-priority body is still drawn, and what
        # survived is a leading slice of the source (ellipsis/space trimmed), i.e.
        # the fit truncated rather than dropped or garbled it.
        name, src = body_probe[kind]
        rendered = _rendered_text(ch, name)
        check(f"{kind}: highest-priority body survives the fit", bool(rendered))
        if rendered:
            kept = rendered.rstrip("… ").strip()
            check(f"{kind}: surviving body text is a prefix of the source",
                  bool(kept) and src.startswith(kept))

        glass = [(y, h) for n, x, y, w, h in _bounds(ch) if "Footer Glass" in n]
        if kind == "unit":
            check("unit: no footer glass (uses the stat ribbon)", not glass)
        else:
            # assert presence first, so a shape rename fails loudly instead of
            # vacuously skipping the on-card bounds check.
            check(f"{kind}: footer glass shape present", bool(glass))
            gy, gh = glass[0]
            check(f"{kind}: footer glass stays on-card (top {gy:.0f})",
                  gy >= 0 and gy + gh <= card_h + 1.0)


if __name__ == "__main__":
    test_load_keyword_vocab()
    test_keyword_reminder()
    test_passives_and_blocks()
    test_block_fitting()
    test_overflow_containment()
    test_nonunit_keywords()
    test_event_type_chip()
    test_real_vocab_reminders()
    test_compose_reminder_degradation()
    test_format_param_edges()
    test_keyword_pill_row()
    if _failures:
        print(f"\n{len(_failures)} FAILED: {', '.join(_failures)}")
        sys.exit(1)
    print("\nAll renderer smoke tests passed.")
