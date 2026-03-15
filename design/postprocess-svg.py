#!/usr/bin/env python3
"""
Post-process Penpot SVG exports for web client use.

Fixes:
- Rewrites internal Docker font URLs to Google Fonts CDN
- Deduplicates @font-face declarations
- Strips textLength/lengthAdjust (allows natural text flow)
- Removes identity transforms
- Strips unnecessary wrapper groups and clip paths

Usage:
    python3 postprocess-svg.py design/exports/unit-card.svg
    python3 postprocess-svg.py design/exports/*.svg
    python3 postprocess-svg.py design/exports/unit-card.svg -o design/exports/clean/
"""

import argparse
import os
import re
import sys
from xml.etree import ElementTree as ET

# ---------------------------------------------------------------------------
# Font URL mapping: Penpot internal → Google Fonts CDN
# ---------------------------------------------------------------------------
GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2?family=Source+Sans+Pro:ital,wght@0,400;0,600;0,700;1,400&display=block"

# Penpot font URL pattern
PENPOT_FONT_URL_RE = re.compile(r"http://penpot-frontend:\d+/fonts/\S+")

# ---------------------------------------------------------------------------
# SVG namespace handling
# ---------------------------------------------------------------------------
SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)


def ns(tag):
    return f"{{{SVG_NS}}}{tag}"


# ---------------------------------------------------------------------------
# Post-processing steps
# ---------------------------------------------------------------------------

def rewrite_fonts(style_text):
    """Replace Penpot @font-face blocks with a single Google Fonts @import."""
    # Remove all @font-face blocks
    cleaned = re.sub(
        r"@font-face\s*\{[^}]*\}\s*",
        "",
        style_text,
    )
    # Prepend @import for Google Fonts
    import_rule = f'@import url("{GOOGLE_FONTS_CSS}");\n'
    # Map Penpot font-family name to CSS name
    cleaned = import_rule + cleaned
    return cleaned


def strip_text_length(root):
    """Remove textLength and lengthAdjust attributes from <text> elements."""
    for text_el in root.iter(ns("text")):
        text_el.attrib.pop("textLength", None)
        text_el.attrib.pop("lengthAdjust", None)


def fix_font_family(root):
    """Rewrite font-family from Penpot internal name to CSS name in style attrs."""
    for el in root.iter():
        style = el.get("style", "")
        if "sourcesanspro" in style:
            el.set("style", style.replace(
                "font-family: sourcesanspro",
                "font-family: 'Source Sans Pro', sans-serif",
            ))


def remove_identity_transforms(root):
    """Strip transform='matrix(1,0,0,1,0,0)' (identity matrix)."""
    identity_re = re.compile(
        r"matrix\(\s*1\.?0*\s*,\s*0\.?0*\s*,\s*0\.?0*\s*,\s*1\.?0*\s*,\s*0\.?0*\s*,\s*0\.?0*\s*\)"
    )
    for el in root.iter():
        transform = el.get("transform", "")
        if transform and identity_re.fullmatch(transform.strip()):
            del el.attrib["transform"]


def remove_fill_patterns(root):
    """Remove <pattern> elements inside text containers (unused fill patterns)."""
    for defs in root.iter(ns("defs")):
        patterns = [p for p in defs if p.tag == ns("pattern")]
        for p in patterns:
            defs.remove(p)
        # Remove empty <defs>
        if len(defs) == 0:
            parent = find_parent(root, defs)
            if parent is not None:
                parent.remove(defs)


def find_parent(root, target):
    """Find parent of a target element."""
    for parent in root.iter():
        for child in parent:
            if child is target:
                return parent
    return None


def unwrap_single_child_groups(root):
    """Unwrap <g> elements that have exactly one child and no meaningful attributes.

    Attributes like x/y/width/height on <g> are invalid SVG (leftover from
    Penpot text containers) and are safe to discard.
    """
    meaningful_attrs = {"id", "clip-path", "filter", "mask", "opacity"}
    # Attributes that are invalid on <g> and can be safely dropped
    droppable_attrs = {"x", "y", "width", "height", "rx", "ry"}

    changed = True
    while changed:
        changed = False
        for parent in root.iter():
            to_unwrap = []
            for i, child in enumerate(parent):
                if child.tag != ns("g") or len(child) != 1:
                    continue
                if child.text or child.tail:
                    continue
                real_attrs = set(child.attrib.keys()) - droppable_attrs
                if real_attrs & meaningful_attrs:
                    continue
                to_unwrap.append((i, child))

            for offset, g in reversed(to_unwrap):
                inner = g[0]
                inner.tail = g.tail
                parent.remove(g)
                parent.insert(offset, inner)
                changed = True


def strip_screenshot_id(root):
    """Clean up screenshot-prefixed IDs on the root group."""
    root_id = root.get("id", "")
    if root_id.startswith("screenshot-"):
        root.set("id", root_id.replace("screenshot-", "card-"))


def clean_class_attrs(root):
    """Remove Penpot internal CSS classes (frame-clip, fills, strokes, etc.)."""
    for el in root.iter():
        cls = el.get("class", "")
        if cls and any(c in cls for c in [
            "frame-clip", "frame-container", "frame-background",
            "stroke-shape", "text-container",
        ]):
            del el.attrib["class"]


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def postprocess(svg_path, output_path=None):
    """Run all post-processing steps on an SVG file."""
    try:
        tree = ET.parse(svg_path)
    except ET.ParseError as e:
        print(f"ERROR: Failed to parse SVG '{svg_path}': {e}", file=sys.stderr)
        raise
    root = tree.getroot()

    # Process <style> elements
    for style_el in root.iter(ns("style")):
        if style_el.text:
            style_el.text = rewrite_fonts(style_el.text)

    strip_text_length(root)
    fix_font_family(root)
    remove_identity_transforms(root)
    remove_fill_patterns(root)
    unwrap_single_child_groups(root)
    strip_screenshot_id(root)
    clean_class_attrs(root)

    # Write output
    if output_path is None:
        base, ext = os.path.splitext(svg_path)
        output_path = f"{base}.clean{ext}"

    ET.indent(tree, space="  ")
    tree.write(output_path, xml_declaration=False, encoding="unicode")

    # Read back and fix the XML declaration / namespace prefix
    with open(output_path, "r") as f:
        content = f.read()

    # Ensure xmlns is on the root <svg> element (ET sometimes drops it)
    if 'xmlns="' not in content:
        content = content.replace("<svg ", f'<svg xmlns="{SVG_NS}" ', 1)

    with open(output_path, "w") as f:
        f.write(content)

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Post-process Penpot SVG exports")
    parser.add_argument("files", nargs="+", help="SVG files to process")
    parser.add_argument("-o", "--output-dir", help="Output directory (default: same dir with .clean.svg suffix)")
    args = parser.parse_args()

    for svg_path in args.files:
        if not os.path.isfile(svg_path):
            print(f"Skipping {svg_path}: not a file", file=sys.stderr)
            continue

        if args.output_dir:
            os.makedirs(args.output_dir, exist_ok=True)
            output_path = os.path.join(args.output_dir, os.path.basename(svg_path))
        else:
            output_path = None  # auto-generates .clean.svg

        original_size = os.path.getsize(svg_path)
        if original_size == 0:
            print(f"WARNING: {svg_path} is empty (0 bytes), skipping", file=sys.stderr)
            continue

        out = postprocess(svg_path, output_path)
        clean_size = os.path.getsize(out)
        reduction = (1 - clean_size / original_size) * 100
        print(f"{svg_path} → {out}  ({original_size} → {clean_size} bytes, {reduction:.0f}% smaller)")


if __name__ == "__main__":
    main()
