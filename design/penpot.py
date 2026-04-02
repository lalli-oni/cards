"""Shared Penpot API client and shape builder utilities.

Provides PenpotClient for authentication, file operations, and exports,
plus pure-function geometry helpers and shape/change builders used by
both setup-template.py and compose-cards.py.
"""

import json
import os
import uuid
import urllib.request
import urllib.error
import http.cookiejar
import sys

# Load .env file from the design/ directory if present
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.isfile(_ENV_PATH):
    with open(_ENV_PATH) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _key, _, _val = _line.partition("=")
                os.environ.setdefault(_key.strip(), _val.strip().strip('"').strip("'"))


# ---------------------------------------------------------------------------
# Geometry helpers (pure functions)
# ---------------------------------------------------------------------------

def new_uuid() -> str:
    return str(uuid.uuid4())


def make_selrect(x, y, w, h) -> dict:
    return {
        "x": x, "y": y, "width": w, "height": h,
        "x1": x, "y1": y, "x2": x + w, "y2": y + h,
    }


def make_points(x, y, w, h) -> list:
    return [
        {"x": x, "y": y}, {"x": x + w, "y": y},
        {"x": x + w, "y": y + h}, {"x": x, "y": y + h},
    ]


def identity_transform() -> dict:
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


# ---------------------------------------------------------------------------
# Text content builder
# ---------------------------------------------------------------------------

def make_text_content(
    text, font_size="14", font_weight="400",
    fill_color="#ffffff", fill_opacity=1,
    font_style=None, text_align=None,
    font_family="sourcesanspro", font_id="gfont-source-sans-pro",
) -> dict:
    """Build Penpot text content structure.

    CRITICAL: Sets text-align at BOTH paragraph level AND text-attrs level,
    otherwise centering does not work in the Penpot exporter.
    """
    text_attrs = {
        "text": text,
        "font-family": font_family,
        "font-id": font_id,
        "font-size": str(font_size),
        "font-weight": str(font_weight),
        "fill-color": fill_color,
        "fill-opacity": fill_opacity,
    }
    if font_style:
        text_attrs["font-style"] = font_style
    if text_align:
        text_attrs["text-align"] = text_align

    paragraph = {
        "type": "paragraph",
        "children": [text_attrs],
    }
    if text_align:
        paragraph["text-align"] = text_align

    return {
        "type": "root",
        "children": [{"type": "paragraph-set", "children": [paragraph]}],
    }


def make_position_data(text, x, y, w, h, font_size="14", font_weight="400",
                       fill_color="#ffffff", fill_opacity=1,
                       font_style=None, font_family="sourcesanspro",
                       text_align=None) -> list:
    """Build approximate position-data for the SVG exporter.

    The Penpot SVG exporter uses Playwright to screenshot text elements. It
    locates them via `#screenshot-text-{id} foreignObject`, which only renders
    when position-data is present. Normally Penpot's frontend JS computes
    pixel-perfect position-data when a file is opened in the editor, but
    API-only workflows never trigger that.

    Key calibration notes from actual Penpot-computed values:
    - width = approximate rendered text width (NOT container width)
    - height = approximately font_size * 1.3
    - y = shape_y + font_size * 1.2 (baseline position)
    - fontWeight is always "400" in position-data regardless of actual weight
    - x1/y1/x2/y2 are relative offsets within the text line
    - For centered text, x is offset to center text_w within container w
    """
    fs = float(font_size)
    line_h = fs * 1.3
    # Approximate rendered width: ~0.6 * font_size per character
    text_w = len(text) * fs * 0.6

    # Position x: centered if text_align is "center"
    if text_align == "center":
        text_x = x + (w - text_w) / 2
        x1 = (w - text_w) / 2
    else:
        text_x = x
        x1 = 0

    return [{
        "x": text_x,
        "y": y + fs * 1.2,
        "width": text_w,
        "height": line_h,
        "x1": x1,
        "y1": -1,
        "x2": x1 + text_w,
        "y2": line_h - 1,
        "fontStyle": font_style or "normal",
        "textTransform": "none",
        "fontSize": f"{font_size}px",
        "fontWeight": "400",
        "textDecoration": "none",
        "letterSpacing": "normal",
        "fills": [{"fillColor": fill_color, "fillOpacity": fill_opacity}],
        "direction": "ltr",
        "fontFamily": font_family,
        "text": text,
    }]


# ---------------------------------------------------------------------------
# Gradient helpers — return fill/stroke dicts for use in shape builders
# ---------------------------------------------------------------------------

def make_linear_gradient_fill(start_x, start_y, end_x, end_y, stops, opacity=1):
    """Build a linear gradient fill entry.

    Coordinates are normalized 0-1 relative to the shape's bounding box.
    stops: [{"color": "#hex", "offset": 0-1, "opacity": 0-1}, ...]
    """
    return {
        "fill-color-gradient": {
            "type": "linear",
            "start-x": start_x, "start-y": start_y,
            "end-x": end_x, "end-y": end_y,
            "width": 1,
            "stops": stops,
        },
        "fill-opacity": opacity,
    }


def make_radial_gradient_fill(start_x, start_y, end_x, end_y, width, stops, opacity=1):
    """Build a radial gradient fill entry.

    start: gradient center (normalized 0-1).
    end: outer edge point (determines radius direction/length).
    width: ellipse width ratio (1 = circle).
    """
    return {
        "fill-color-gradient": {
            "type": "radial",
            "start-x": start_x, "start-y": start_y,
            "end-x": end_x, "end-y": end_y,
            "width": width,
            "stops": stops,
        },
        "fill-opacity": opacity,
    }


def make_gradient_stroke(grad_type, start_x, start_y, end_x, end_y, stops,
                         width, grad_width=1, alignment="center", opacity=1):
    """Build a gradient stroke entry."""
    return {
        "stroke-color-gradient": {
            "type": grad_type,
            "start-x": start_x, "start-y": start_y,
            "end-x": end_x, "end-y": end_y,
            "width": grad_width,
            "stops": stops,
        },
        "stroke-width": width,
        "stroke-alignment": alignment,
        "stroke-style": "solid",
        "stroke-opacity": opacity,
    }


# ---------------------------------------------------------------------------
# Shape builders — each returns (shape_id, add_change)
# ---------------------------------------------------------------------------

def make_rect(name, x, y, w, h, fills, page_id, parent_id, frame_id,
              strokes=None, r1=None, r2=None, r3=None, r4=None, opacity=None):
    sid = new_uuid()
    obj = {
        "id": sid, "type": "rect", "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": make_selrect(x, y, w, h),
        "points": make_points(x, y, w, h),
        "transform": identity_transform(),
        "transform-inverse": identity_transform(),
        "parent-id": parent_id, "frame-id": frame_id,
        "fills": fills, "strokes": strokes or [],
    }
    if r1 is not None:
        obj.update({"r1": r1, "r2": r2, "r3": r3, "r4": r4})
    if opacity is not None:
        obj["opacity"] = opacity
    change = {
        "type": "add-obj", "page-id": page_id,
        "parent-id": parent_id, "frame-id": frame_id,
        "id": sid, "obj": obj,
    }
    return sid, change


def make_circle(name, x, y, w, h, fills, page_id, parent_id, frame_id,
                strokes=None, opacity=None):
    sid = new_uuid()
    obj = {
        "id": sid, "type": "circle", "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": make_selrect(x, y, w, h),
        "points": make_points(x, y, w, h),
        "transform": identity_transform(),
        "transform-inverse": identity_transform(),
        "parent-id": parent_id, "frame-id": frame_id,
        "fills": fills, "strokes": strokes or [],
    }
    if opacity is not None:
        obj["opacity"] = opacity
    change = {
        "type": "add-obj", "page-id": page_id,
        "parent-id": parent_id, "frame-id": frame_id,
        "id": sid, "obj": obj,
    }
    return sid, change


def make_text(name, x, y, w, h, text, page_id, parent_id, frame_id,
              font_size="14", font_weight="400", fill_color="#ffffff",
              font_style=None, text_align=None):
    sid = new_uuid()
    content = make_text_content(
        text, font_size=font_size, font_weight=font_weight,
        fill_color=fill_color, font_style=font_style, text_align=text_align,
    )
    obj = {
        "id": sid, "type": "text", "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": make_selrect(x, y, w, h),
        "points": make_points(x, y, w, h),
        "transform": identity_transform(),
        "transform-inverse": identity_transform(),
        "parent-id": parent_id, "frame-id": frame_id,
        "fills": [], "strokes": [],
        "content": content,
        "grow-type": "fixed",
        "position-data": make_position_data(
            text, x, y, w, h,
            font_size=font_size, font_weight=font_weight,
            fill_color=fill_color, font_style=font_style,
            text_align=text_align,
        ),
    }
    change = {
        "type": "add-obj", "page-id": page_id,
        "parent-id": parent_id, "frame-id": frame_id,
        "id": sid, "obj": obj,
    }
    return sid, change


def make_frame(name, x, y, w, h, page_id, parent_id, frame_id, fills=None):
    sid = new_uuid()
    obj = {
        "id": sid, "type": "frame", "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": make_selrect(x, y, w, h),
        "points": make_points(x, y, w, h),
        "transform": identity_transform(),
        "transform-inverse": identity_transform(),
        "parent-id": parent_id, "frame-id": frame_id,
        "fills": fills or [{"fill-color": "#FFFFFF", "fill-opacity": 0}],
        "strokes": [], "shapes": [],
    }
    change = {
        "type": "add-obj", "page-id": page_id,
        "parent-id": parent_id, "frame-id": frame_id,
        "id": sid, "obj": obj,
    }
    return sid, change


def make_image(name, x, y, w, h, media_id, media_width, media_height, mtype,
               page_id, parent_id, frame_id):
    """Build an image shape from previously uploaded media."""
    sid = new_uuid()
    obj = {
        "id": sid, "type": "image", "name": name,
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "selrect": make_selrect(x, y, w, h),
        "points": make_points(x, y, w, h),
        "transform": identity_transform(),
        "transform-inverse": identity_transform(),
        "parent-id": parent_id, "frame-id": frame_id,
        "fills": [], "strokes": [],
        "metadata": {
            "id": media_id,
            "width": media_width,
            "height": media_height,
            "mtype": mtype,
        },
    }
    change = {
        "type": "add-obj", "page-id": page_id,
        "parent-id": parent_id, "frame-id": frame_id,
        "id": sid, "obj": obj,
    }
    return sid, change


# ---------------------------------------------------------------------------
# Change helpers
# ---------------------------------------------------------------------------

def mod_text_change(page_id, object_id, content, shape_geom=None) -> dict:
    """Build mod-obj change that updates text content.

    If shape_geom is provided as (x, y, w, h), sets approximate position-data
    so the SVG exporter can find text elements. If omitted, position-data is
    set to None — SVG exports for this shape will fail or time out.
    """
    # Extract text properties from content for position-data
    pos_data = None
    if shape_geom:
        x, y, w, h = shape_geom
        # Dig into content structure to get font attrs
        text = font_size = font_weight = fill_color = font_style = text_align = ""
        for ps in content.get("children", []):
            for p in ps.get("children", []):
                text_align = p.get("text-align") or text_align
                for child in p.get("children", []):
                    text = child.get("text", "")
                    font_size = child.get("font-size", "14")
                    font_weight = child.get("font-weight", "400")
                    fill_color = child.get("fill-color", "#ffffff")
                    font_style = child.get("font-style")
                    text_align = child.get("text-align") or text_align
        pos_data = make_position_data(
            text, x, y, w, h,
            font_size=font_size, font_weight=font_weight,
            fill_color=fill_color, font_style=font_style,
            text_align=text_align or None,
        )

    return {
        "type": "mod-obj",
        "page-id": page_id,
        "id": object_id,
        "operations": [
            {"type": "set", "attr": "content", "val": content},
            {"type": "set", "attr": "position-data", "val": pos_data},
        ],
    }


def mod_fills_change(page_id, object_id, fills) -> dict:
    return {
        "type": "mod-obj",
        "page-id": page_id,
        "id": object_id,
        "operations": [
            {"type": "set", "attr": "fills", "val": fills},
        ],
    }


def del_obj_change(page_id, object_id) -> dict:
    return {"type": "del-obj", "page-id": page_id, "id": object_id}


def reposition_shape(shape_id, x, y, w, h, objects, page_id, parent_id, frame_id) -> list:
    """Delete + re-add shape at new position (preserves ID).

    mod-obj cannot update selrect (Penpot requires a Rect record, not a plain map).
    Delete + add-obj with the same ID bypasses this — add-obj runs the JSON decoder
    which converts the map to a Rect record.
    """
    shape = objects[shape_id]
    new_obj = dict(shape)
    new_obj.update({
        "x": x, "y": y, "width": w, "height": h,
        "selrect": make_selrect(x, y, w, h),
        "points": make_points(x, y, w, h),
    })
    if shape.get("type") == "text":
        new_obj["position-data"] = None
    return [
        del_obj_change(page_id, shape_id),
        {
            "type": "add-obj", "page-id": page_id,
            "parent-id": parent_id, "frame-id": frame_id,
            "id": shape_id, "obj": new_obj,
        },
    ]


# ---------------------------------------------------------------------------
# PenpotClient
# ---------------------------------------------------------------------------

FEATURES = [
    "fdata/objects-map", "fdata/shape-data-type", "fdata/path-data",
    "components/v2", "styles/v2", "design-tokens/v1", "variants/v1",
    "layout/grid", "plugins/runtime",
]


class PenpotClient:
    def __init__(self, base_url=None, email=None, password=None):
        self.base_url = base_url or os.environ.get("PENPOT_URL", "http://localhost:9001")
        self.email = email or os.environ.get("PENPOT_EMAIL")
        self.password = password or os.environ.get("PENPOT_PASSWORD")
        self.api_url = f"{self.base_url}/api/rpc/command"
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar)
        )
        self.profile_id = None
        self.auth_token = None

    def api_post(self, endpoint, payload) -> dict:
        url = f"{self.api_url}/{endpoint}"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with self.opener.open(req) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            print(f"ERROR {exc.code} from {endpoint}: {body[:500]}", file=sys.stderr)
            sys.exit(1)
        except urllib.error.URLError as exc:
            print(f"Connection error reaching {url}: {exc.reason}", file=sys.stderr)
            print("Is Penpot running? Check: docker compose -f design/docker-compose.yaml ps", file=sys.stderr)
            sys.exit(1)

    def login(self) -> dict:
        if not self.email or not self.password:
            print("ERROR: PENPOT_EMAIL and PENPOT_PASSWORD must be set in design/.env or environment", file=sys.stderr)
            sys.exit(1)
        resp = self.api_post("login-with-password", {
            "email": self.email, "password": self.password,
        })
        if "id" not in resp:
            print(f"ERROR: Login response missing 'id' field. Response: {resp}", file=sys.stderr)
            sys.exit(1)
        self.profile_id = resp["id"]
        for cookie in self.cookie_jar:
            if cookie.name == "auth-token":
                self.auth_token = cookie.value
                break
        if not self.auth_token:
            print("ERROR: Login succeeded but no auth-token cookie was set.", file=sys.stderr)
            print("This may indicate a Penpot version mismatch or proxy issue.", file=sys.stderr)
            sys.exit(1)
        return resp

    def get_file(self, file_id) -> dict:
        return self.api_post("get-file", {"id": file_id, "features": FEATURES})

    def update_file(self, file_id, changes, revn, vern, session_id=None) -> dict:
        return self.api_post("update-file", {
            "id": file_id,
            "session-id": session_id or new_uuid(),
            "revn": revn,
            "vern": vern,
            "changes": changes,
        })

    def get_page_objects(self, file_data, page_id) -> dict:
        try:
            return file_data["data"]["pagesIndex"][page_id]["objects"]
        except KeyError:
            available = list(file_data.get("data", {}).get("pagesIndex", {}).keys())
            print(f"ERROR: Page {page_id} not found. Available pages: {available}", file=sys.stderr)
            sys.exit(1)

    def find_shapes_by_name(self, objects, names, frame_id=None) -> dict:
        """Return {name: shape_id} for each name found in objects.

        Eliminates ALL hardcoded UUIDs — shapes are discovered at runtime.
        If frame_id is provided, only searches shapes belonging to that frame.
        """
        result = {}
        for oid, obj in objects.items():
            if frame_id and obj.get("frameId", obj.get("frame-id")) != frame_id and oid != frame_id:
                continue
            n = obj.get("name")
            if n in names:
                if n in result:
                    print(f"ERROR: duplicate shape name '{n}' in frame "
                          f"(IDs: {result[n]}, {oid}). "
                          f"Delete the duplicate in Penpot and re-run.", file=sys.stderr)
                    sys.exit(1)
                result[n] = oid
        return result

    def upload_media(self, file_id, name, file_path, content_type="image/svg+xml") -> dict:
        """Upload a media file to a Penpot file. Returns media object with id/width/height/mtype."""
        boundary = f"----PenpotBoundary{uuid.uuid4().hex}"

        with open(file_path, "rb") as f:
            file_data = f.read()

        filename = os.path.basename(file_path)
        parts = []
        for field_name, field_value in [("file-id", file_id), ("is-local", "true"), ("name", name)]:
            parts.append(f"--{boundary}\r\n"
                         f"Content-Disposition: form-data; name=\"{field_name}\"\r\n\r\n"
                         f"{field_value}\r\n")
        # File part
        parts.append(f"--{boundary}\r\n"
                     f"Content-Disposition: form-data; name=\"content\"; filename=\"{filename}\"\r\n"
                     f"Content-Type: {content_type}\r\n\r\n")

        body = "".join(parts).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("utf-8")

        url = f"{self.api_url}/upload-file-media-object"
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Cookie": f"auth-token={self.auth_token}",
        })
        try:
            with self.opener.open(req) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
                # Response is transit+json encoded: ["^ ", "~:key", val, ...]
                # Convert to plain dict, stripping transit prefixes.
                if isinstance(raw, list) and raw and raw[0] == "^ ":
                    items = raw[1:]
                    if len(items) % 2 != 0:
                        print(f"ERROR: transit response has odd item count ({len(items)})", file=sys.stderr)
                        sys.exit(1)
                    result = {}
                    for i in range(0, len(items), 2):
                        k = items[i]
                        k = k[2:] if k.startswith("~:") else k
                        v = items[i + 1]
                        if isinstance(v, str) and v.startswith("~u"):
                            v = v[2:]
                        result[k] = v
                    return result
                return raw
        except json.JSONDecodeError:
            print("ERROR: upload_media response is not valid JSON", file=sys.stderr)
            sys.exit(1)
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            print(f"ERROR {exc.code} uploading media: {err_body[:500]}", file=sys.stderr)
            sys.exit(1)
        except urllib.error.URLError as exc:
            print(f"Connection error uploading media: {exc.reason}", file=sys.stderr)
            sys.exit(1)

    def export_png(self, file_id, page_id, object_id) -> bytes:
        return self._export(file_id, page_id, object_id, "~:png")

    def export_svg(self, file_id, page_id, object_id) -> bytes:
        return self._export(file_id, page_id, object_id, "~:svg")

    def _export(self, file_id, page_id, object_id, export_type) -> bytes:
        """Export an object using the Penpot export API (transit+json)."""
        url = f"{self.base_url}/api/export"
        payload = json.dumps({
            "~:wait": True,
            "~:exports": [{
                "~:type": export_type,
                "~:suffix": "",
                "~:scale": 1,
                "~:page-id": f"~u{page_id}",
                "~:file-id": f"~u{file_id}",
                "~:name": "",
                "~:object-id": f"~u{object_id}",
            }],
            "~:profile-id": f"~u{self.profile_id}",
            "~:cmd": "~:export-shapes",
        }).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers={
            "Content-Type": "application/transit+json",
            "Accept": "application/transit+json",
            "Cookie": f"auth-token={self.auth_token}",
        })
        try:
            with self.opener.open(req) as resp:
                body = resp.read().decode("utf-8")
                if not body:
                    print("ERROR: Export API returned empty response", file=sys.stderr)
                    sys.exit(1)
                data = json.loads(body)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            print(f"ERROR {exc.code} from export API: {body[:500]}", file=sys.stderr)
            sys.exit(1)
        except urllib.error.URLError as exc:
            print(f"Connection error reaching export API: {exc.reason}", file=sys.stderr)
            sys.exit(1)

        uri_value = data.get("~:uri", {})
        asset_uri = uri_value.get("~#uri") if isinstance(uri_value, dict) else uri_value
        if not asset_uri:
            print(f"ERROR: Export API returned no asset URI for object {object_id}.", file=sys.stderr)
            print(f"  Response keys: {list(data.keys())}", file=sys.stderr)
            sys.exit(1)

        if not asset_uri.startswith("http"):
            asset_uri = f"{self.base_url}{asset_uri}"

        dl_req = urllib.request.Request(asset_uri, headers={
            "Cookie": f"auth-token={self.auth_token}",
        })
        try:
            with self.opener.open(dl_req) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            print(f"ERROR {exc.code} downloading exported asset: {asset_uri}", file=sys.stderr)
            sys.exit(1)
        except urllib.error.URLError as exc:
            print(f"Connection error downloading asset: {exc.reason}", file=sys.stderr)
            sys.exit(1)
