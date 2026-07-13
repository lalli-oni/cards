#!/usr/bin/env python3
"""Preflight / doctor for the Penpot card-rendering environment.

Validates that design/.env and the local Penpot stack are in a state where
setup-template.py, compose-cards.py, and moderntrek-template.py can actually
run. It checks the failure modes we've hit for real:

  - PENPOT_SECRET_KEY missing/empty        -> backend crash-loops on startup
  - services not started                   -> connection refused / 502
  - exporter started before the backend    -> stale secret -> export 403
  - PENPOT_FILE_ID points at a deleted file -> get-file 404
  - bad/absent credentials                 -> login fails

Usage:
    python3 preflight.py         # diagnose only; exits non-zero if any check FAILs
    python3 preflight.py --fix   # also apply safe repairs (secret key, start/recreate
                                 # services, create file)

--fix only performs safe, reversible repairs. It never invents credentials.
When PENPOT_URL points at a remote Penpot, the local Docker/stack checks are
skipped and only the remote instance is probed.
"""

import argparse
import http.cookiejar
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

try:
    from penpot import FEATURES
except ImportError:
    # Narrow to ImportError: a real error inside penpot.py (syntax/refactor)
    # should surface loudly rather than silently fall back to a stale list.
    FEATURES = ["fdata/objects-map", "components/v2", "styles/v2"]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(SCRIPT_DIR, ".env")
COMPOSE_PATH = os.path.join(SCRIPT_DIR, "docker-compose.yaml")

# The services required for rendering. penpot-mailcatch is intentionally
# excluded — it is a dev mail sink and not needed by the render pipeline.
EXPECTED_SERVICES = [
    "penpot-postgres", "penpot-valkey",
    "penpot-backend", "penpot-exporter", "penpot-frontend",
]

# ANSI-free status markers (terminal-safe)
OK, WARN, FAIL, FIX = "OK", "WARN", "FAIL", "FIX"
_MARK = {OK: "[ OK ]", WARN: "[WARN]", FAIL: "[FAIL]", FIX: "[FIX ]"}

_had_fail = False


def report(level, msg, detail=None):
    global _had_fail
    if level == FAIL:
        _had_fail = True
    print(f"{_MARK[level]} {msg}")
    if detail:
        for line in detail.splitlines():
            print(f"       {line}")


# ---------------------------------------------------------------------------
# .env helpers
# ---------------------------------------------------------------------------

def read_env_values():
    """Parse design/.env into {key: value}. Returns None if the file is absent."""
    if not os.path.isfile(ENV_PATH):
        return None
    values = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def _line_key(line):
    """The env key a line defines, ignoring a leading `export `. '' if none/comment."""
    if line.lstrip().startswith("#") or "=" not in line:
        return ""
    key = line.split("=", 1)[0].strip()
    if key.startswith("export "):
        key = key[len("export "):].strip()
    return key


def set_env_value(key, value):
    """Update or append KEY=value in design/.env, preserving other lines.

    Values are written unquoted, so callers must only pass shell/compose-safe
    values (docker compose --env-file treats surrounding quotes literally, so
    quoting here would corrupt the value). Current callers write url-safe
    tokens and UUIDs, which are safe. Raises OSError if .env cannot be written.
    """
    lines, found = [], False
    if os.path.isfile(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                if _line_key(line) == key:
                    lines.append(f"{key}={value}\n")
                    found = True
                else:
                    lines.append(line)
    if not found:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(f"{key}={value}\n")
    with open(ENV_PATH, "w") as f:
        f.writelines(lines)


def try_set_env(key, value):
    """set_env_value with an OSError guard. Returns True on success."""
    try:
        set_env_value(key, value)
        return True
    except OSError as e:
        report(FAIL, f"Could not write {key} to design/.env", str(e))
        return False


# ---------------------------------------------------------------------------
# Shell / docker helpers
# ---------------------------------------------------------------------------

def run(cmd, timeout=60):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", f"{cmd[0]}: not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timed out"


def compose(*args, timeout=120):
    return run(["docker", "compose", "-f", COMPOSE_PATH, "--env-file", ENV_PATH, *args],
               timeout=timeout)


def running_services():
    """Return {service: state} for compose services, or None if the query failed.

    None (command error) is deliberately distinct from {} (command succeeded,
    no containers) so callers don't mistake "couldn't tell" for "nothing runs".
    """
    code, out, err = compose("ps", "--format", "json")
    if code != 0:
        return None
    states = {}
    out = out.strip()
    if not out:
        return states
    # Compose emits either a JSON array or one JSON object per line.
    try:
        parsed = json.loads(out)
        rows = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        rows = []
        for line in out.splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    for r in rows:
        svc = r.get("Service") or r.get("service")
        if svc:
            states[svc] = (r.get("State") or r.get("state") or "").lower()
    return states


def container_started_at(service):
    code, cid, _ = compose("ps", "-q", service)
    cid = cid.strip().splitlines()[0] if cid.strip() else ""
    if code != 0 or not cid:
        return None
    code, out, _ = run(["docker", "inspect", "-f", "{{.State.StartedAt}}", cid])
    return out.strip() if code == 0 and out.strip() else None


def parse_docker_ts(s):
    """Parse Docker's RFC3339Nano StartedAt into a datetime, or None.

    Docker emits variable-precision fractional seconds (up to 9 digits) with a
    Z suffix; truncate to microseconds so datetime.fromisoformat accepts it.
    Parsing (rather than string comparison) avoids misordering timestamps whose
    fractional-digit counts differ.
    """
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    m = re.match(r"(.*\.\d{6})\d*(.*)", s)  # keep 6 fractional digits, drop the rest
    if m:
        s = m.group(1) + m.group(2)
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# HTTP / Penpot helpers
# ---------------------------------------------------------------------------

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))


def base_url(env):
    return env.get("PENPOT_URL") or f"http://localhost:{env.get('PENPOT_PORT', '9011')}"


def http_status(url, timeout=8):
    try:
        with _opener.open(url, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return 0


def rpc(base, cmd, payload, timeout=12):
    """POST an RPC command. Returns (status_code, parsed_body_or_none).

    status_code is 0 for a connection-level failure (no HTTP response).
    """
    url = f"{base}/api/rpc/command/{cmd}"
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with _opener.open(req, timeout=timeout) as r:
            body = r.read().decode("utf-8")
            return r.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return e.code, None
    except (urllib.error.URLError, OSError):
        return 0, None


def wait_for_backend(base, timeout=180):
    """Poll until the backend API is reachable (answers any HTTP status, not a
    502 / connection error). Reachable means "not crash-looping" — not "healthy"."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, _ = rpc(base, "get-profile", {}, timeout=5)
        if code in (200, 400, 401, 403):
            return True
        time.sleep(5)
    return False


def _create_file(base):
    """Create a Penpot project + file (requires an active login). Returns the
    file id, or None (reporting which RPC failed) so callers don't fail silently."""
    code, profile = rpc(base, "get-profile", {})
    team_id = (profile or {}).get("defaultTeamId")
    if not team_id:
        report(WARN, f"create-file: get-profile failed (HTTP {code or 'no response'})")
        return None
    code, project = rpc(base, "create-project", {"team-id": team_id, "name": "Card Game"})
    pid = (project or {}).get("id")
    if not pid:
        report(WARN, f"create-file: create-project failed (HTTP {code or 'no response'})")
        return None
    code, file_resp = rpc(base, "create-file", {"project-id": pid, "name": "Card Templates"})
    fid = (file_resp or {}).get("id")
    if not fid:
        report(WARN, f"create-file: create-file failed (HTTP {code or 'no response'}); "
                     f"orphan project {pid} left behind")
        return None
    return fid


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Penpot rendering environment doctor")
    parser.add_argument("--fix", action="store_true",
                        help="apply safe repairs (secret key, start/recreate services, create file)")
    args = parser.parse_args()

    print("Penpot rendering environment preflight\n" + "-" * 38)

    # 1. .env present
    env = read_env_values()
    if env is None:
        report(FAIL, "design/.env not found",
               "Copy the template:  cp design/.env.example design/.env\n"
               "then fill in PENPOT_EMAIL / PENPOT_PASSWORD.")
        return 1
    report(OK, "design/.env present")

    # 2. Credentials (cannot be auto-fixed)
    for key in ("PENPOT_EMAIL", "PENPOT_PASSWORD"):
        if not env.get(key):
            report(FAIL, f"{key} is empty", "Set it in design/.env — cannot be auto-generated.")
    if _had_fail:
        return 1

    base = base_url(env)
    url = env.get("PENPOT_URL", "")
    is_remote = bool(url) and not any(h in url for h in ("localhost", "127.0.0.1"))
    restart_needed = False

    if is_remote:
        report(OK, f"PENPOT_URL is remote ({url}) — skipping local Docker/stack checks")
    else:
        # 3. PENPOT_SECRET_KEY (backend asserts on empty -> crash-loop)
        if not env.get("PENPOT_SECRET_KEY"):
            if args.fix:
                key = secrets.token_urlsafe(64)
                if not try_set_env("PENPOT_SECRET_KEY", key):
                    return 1
                env["PENPOT_SECRET_KEY"] = key
                restart_needed = True
                report(FIX, "PENPOT_SECRET_KEY was empty — generated one and wrote it to .env")
            else:
                report(FAIL, "PENPOT_SECRET_KEY is empty",
                       "The backend crash-loops without it. Re-run with --fix to generate one.")
                return 1
        else:
            report(OK, "PENPOT_SECRET_KEY set")

        # 4. Docker daemon
        code, _, _ = run(["docker", "info"], timeout=20)
        if code != 0:
            report(FAIL, "Docker daemon not reachable", "Start Docker Desktop and re-run.")
            return 1
        report(OK, "Docker daemon reachable")

        # 5. Services up
        states = running_services()
        if states is None:
            report(FAIL, "Could not query compose services",
                   "`docker compose ps` failed — check Docker and the compose file.")
            return 1
        down = [s for s in EXPECTED_SERVICES if states.get(s) != "running"]
        if down or restart_needed:
            if args.fix:
                why = "applying new secret" if restart_needed else f"starting: {', '.join(down)}"
                report(FIX, f"Bringing up the Penpot stack ({why})...")
                code, _, err = compose("up", "-d", timeout=240)
                if code != 0:
                    report(FAIL, "docker compose up -d failed", (err or "").strip()[:500])
                    return 1
                if not wait_for_backend(base):
                    report(FAIL, "Backend did not become ready after start",
                           "Check: docker compose -f design/docker-compose.yaml logs penpot-backend")
                    return 1
                report(OK, "Stack started; backend reachable")
            else:
                report(FAIL, f"Services not running: {', '.join(down)}",
                       "docker compose -f design/docker-compose.yaml --env-file design/.env up -d")
                return 1
        else:
            report(OK, "All Penpot services running")

    # 6. Frontend
    fe = http_status(base)
    if fe == 200:
        report(OK, f"Frontend responds ({base})")
    else:
        report(FAIL, f"Frontend not healthy at {base} (HTTP {fe or 'no response'})",
               "The frontend/proxy is not serving — start or check it.")
        return 1

    # 7. Backend API (this is where a crash-loop shows up as 502 / no response)
    code, _ = rpc(base, "get-profile", {})
    if code not in (200, 400, 401, 403):
        report(FAIL, f"Backend API not answering (HTTP {code or 'no response'})",
               "Often a missing PENPOT_SECRET_KEY. Re-run with --fix, or check the backend logs.")
        return 1
    report(OK, "Backend API answering")

    # 8. Exporter freshness — if it started before the backend it may hold a
    #    stale secret and 403 on export. Local stacks only; skipped right after
    #    a --fix restart (everything came up together). Soft signal.
    if not is_remote and not restart_needed:
        be_t = parse_docker_ts(container_started_at("penpot-backend"))
        ex_t = parse_docker_ts(container_started_at("penpot-exporter"))
        if be_t and ex_t:
            if ex_t < be_t:
                report(WARN, "Exporter started before the backend — it may hold a stale secret",
                       "If PNG export 403s, recreate it:\n"
                       "  docker compose -f design/docker-compose.yaml --env-file design/.env up -d "
                       "penpot-exporter penpot-frontend")
        else:
            report(WARN, "Could not determine backend/exporter start order",
                   "Skipping the stale-secret check (docker inspect unavailable).")

    # 9. Login
    code, body = rpc(base, "login-with-password",
                     {"email": env["PENPOT_EMAIL"], "password": env["PENPOT_PASSWORD"]})
    if not (code == 200 and isinstance(body, dict) and body.get("id")):
        if code in (400, 401, 403):
            hint = "Check PENPOT_EMAIL / PENPOT_PASSWORD in design/.env."
        else:
            hint = (f"Backend returned HTTP {code or 'no response'} — a server fault, "
                    "not necessarily bad credentials.")
        report(FAIL, "Login failed", hint)
        return 1
    report(OK, "Login succeeds")

    # 10. PENPOT_FILE_ID resolves
    file_id = env.get("PENPOT_FILE_ID")
    if file_id:
        code, _ = rpc(base, "get-file", {"id": file_id, "features": FEATURES})
        if code == 200:
            report(OK, "PENPOT_FILE_ID resolves")
        elif code == 404:
            if args.fix:
                new_id = _create_file(base)
                if new_id and try_set_env("PENPOT_FILE_ID", new_id):
                    report(FIX, f"Stale PENPOT_FILE_ID — created a fresh file {new_id} and wrote it to .env")
                else:
                    report(FAIL, "Could not create a replacement file")
                    return 1
            else:
                report(WARN, "PENPOT_FILE_ID points at a missing file (404)",
                       "The render scripts will create a new one, or run --fix to set it now.")
        else:
            report(WARN, f"Could not verify PENPOT_FILE_ID (HTTP {code or 'no response'})")
    else:
        if args.fix:
            new_id = _create_file(base)
            if new_id and try_set_env("PENPOT_FILE_ID", new_id):
                report(FIX, f"Created file {new_id} and wrote it to .env")
            else:
                report(FAIL, "Could not create a Penpot file")
                return 1
        else:
            report(WARN, "PENPOT_FILE_ID not set",
                   "The render scripts create one on first run (or run --fix to set it now).")

    print("-" * 38)
    if _had_fail:
        print("Preflight FAILED — resolve the [FAIL] items above.")
        return 1
    print("Preflight passed — environment is ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
