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
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)  # so the module's `from penpot import ...` resolves

_spec = importlib.util.spec_from_file_location(
    "moderntrek_template", os.path.join(SCRIPT_DIR, "moderntrek-template.py"))
mt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mt)

# build/keywords.json is a JSON array of {name, cardTypes}.
VOCAB_JSON = [
    {"name": "Leader", "cardTypes": ["unit"]},
    {"name": "Aura", "cardTypes": ["location"]},
    {"name": "Untouchable", "cardTypes": ["unit"]},
    {"name": "Berserker", "cardTypes": ["unit"]},
    {"name": "Flying", "cardTypes": ["item"]},
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
    check("family token → structural label", label == "LEADER +1 ALL COMBAT")
    # Intentional stub canary — reminder stays "" until prose composition (#194/#209).
    check("family token → blank reminder (composition is a follow-up)", reminder == "")
    check("governed keyword in a populated vocab → no warning", err == "")

    label, _ = mt.keyword_reminder("Untouchable:charisma", VOCAB)
    check("parameterised standalone → label", label == "UNTOUCHABLE CHARISMA")

    label, _ = mt.keyword_reminder("Berserker", VOCAB)
    check("value-less standalone → label", label == "BERSERKER")

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


if __name__ == "__main__":
    test_load_keyword_vocab()
    test_keyword_reminder()
    if _failures:
        print(f"\n{len(_failures)} FAILED: {', '.join(_failures)}")
        sys.exit(1)
    print("\nAll renderer smoke tests passed.")
