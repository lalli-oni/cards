#!/usr/bin/env python3
"""Smoke tests for the glossary consumer in moderntrek-template.py (#203).

The renderer is Python while the rest of the suite is bun/TS, so these run
standalone:  python3 design/test_moderntrek_template.py  (exit 0 = pass).

Covers parse_glossary's degradation paths (missing / non-JSON / wrong-shape /
valid / stale) and keyword_reminder's bracket parse, X-substitution, unknown /
malformed-token / arity-mismatch degradation — the branches that would otherwise
ship unverified.
"""

import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)  # so the module's `from penpot import ...` resolves

_spec = importlib.util.spec_from_file_location(
    "moderntrek_template", os.path.join(SCRIPT_DIR, "moderntrek-template.py"))
mt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mt)

GLOSSARY = {
    "commander": {"id": "commander", "name": "Commander", "scope": "unit",
                  "timing": "static", "valued": True,
                  "reminder": "Friendly units get +X to all stats"},
    "lethal": {"id": "lethal", "name": "Lethal", "scope": "unit",
               "timing": "static", "valued": False,
               "reminder": "The loser is killed instead of injured"},
}

_failures = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}")
    if not cond:
        _failures.append(name)


@contextlib.contextmanager
def _tmp_json(obj_or_text):
    """Write a temp file (dict → JSON, str → raw) and yield its path."""
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


def test_parse_glossary():
    print("parse_glossary:")
    # Missing file → {} + a warning.
    res, err = _quiet(mt.parse_glossary, os.path.join(SCRIPT_DIR, "does-not-exist.json"))
    check("missing file → {}", res == {})
    check("missing file → warns", "not found" in err.lower() or "blank" in err.lower())

    # Valid JSON object → dict passthrough.
    with _tmp_json({"commander": GLOSSARY["commander"]}) as p:
        res, _ = _quiet(mt.parse_glossary, p, __file__)
        check("valid JSON → dict", isinstance(res, dict) and "commander" in res)

    # Non-object JSON (a list) → {} + warning, no crash.
    with _tmp_json([1, 2, 3]) as p:
        res, err = _quiet(mt.parse_glossary, p, __file__)
        check("non-object JSON → {}", res == {})
        check("non-object JSON → warns", "not a json object" in err.lower())

    # Invalid JSON text → {} + warning, no crash.
    with _tmp_json("{ not json ") as p:
        res, err = _quiet(mt.parse_glossary, p, __file__)
        check("unreadable JSON → {}", res == {})

    # Stale (artifact older than rules) → warns but still returns the data.
    with _tmp_json({"commander": GLOSSARY["commander"]}) as p:
        os.utime(p, (0, 0))  # far in the past, older than any rules file
        res, err = _quiet(mt.parse_glossary, p, __file__)
        check("stale artifact → still returns data", "commander" in res)
        check("stale artifact → warns", "stale" in err.lower())


def test_keyword_reminder():
    print("keyword_reminder:")
    label, reminder = mt.keyword_reminder("Commander[3]", GLOSSARY)
    check("valued → COMMANDER 3 label", label == "COMMANDER 3")
    check("valued → X substituted", reminder == "Friendly units get +3 to all stats")

    label, reminder = mt.keyword_reminder("commander[3]", GLOSSARY)
    check("mis-cased → canonical label", label == "COMMANDER 3")

    label, reminder = mt.keyword_reminder("Lethal", GLOSSARY)
    check("value-less → LETHAL label", label == "LETHAL")
    check("value-less → full reminder", reminder == "The loser is killed instead of injured")

    label, reminder = mt.keyword_reminder("Mystery[9]", GLOSSARY)
    check("unknown → label as written", label == "MYSTERY 9")
    check("unknown → blank reminder", reminder == "")

    label, reminder = mt.keyword_reminder("Bogus{x}", GLOSSARY)
    check("malformed token → no crash, blank reminder", label == "BOGUS{X}" and reminder == "")

    # Wrong-shape entry (missing "reminder") must degrade, not KeyError.
    (label, reminder), _ = _quiet(mt.keyword_reminder, "Commander[3]", {"commander": {"scope": "unit"}})
    check("wrong-shape entry → degrades (no crash)", reminder == "")

    # Arity mismatch: valued keyword without a value → warn + blank (no literal X).
    (label, reminder), err = _quiet(mt.keyword_reminder, "Commander", GLOSSARY)
    check("valued w/o value → blank reminder (no literal X)", reminder == "")
    check("valued w/o value → warns", "needs a value" in err.lower())

    # Arity mismatch: value-less keyword given a value → warn, value dropped.
    (label, reminder), err = _quiet(mt.keyword_reminder, "Lethal[2]", GLOSSARY)
    check("value-less w/ value → label drops value", label == "LETHAL")
    check("value-less w/ value → warns", "takes no value" in err.lower())


if __name__ == "__main__":
    test_parse_glossary()
    test_keyword_reminder()
    if _failures:
        print(f"\n{len(_failures)} FAILED: {', '.join(_failures)}")
        sys.exit(1)
    print("\nAll renderer smoke tests passed.")
