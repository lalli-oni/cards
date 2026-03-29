---
name: svg-frutiger-aero
description: Create and style SVG artwork in Frutiger Aero / glossy orb aesthetic. Guides layer composition, per-element radial gradients, gloss overlays, specular lines, and drop shadows. Use when designing logos, icons, or decorative SVG elements that need a 3D glossy look.
---

# SVG Frutiger Aero Style Guide

Create glossy, 3D, orb-like SVG artwork inspired by Frutiger Aero design (2004–2013 era UI: glossy icons, translucent materials, vibrant gradients).

## Arguments
- Description of what to create (e.g. "glossy orange button", "3D icon of a star")
- Optional: base color (defaults to project palette)
- Optional: target size or viewBox

## Core Technique: Per-Element Radial Gradients

The key to this style is that **each visual element gets its own radial gradient**, creating independent 3D orb-like depth. A single shared gradient across multiple elements looks flat.

### Layer Stack (bottom to top)

1. **Drop shadow** — blurred, offset, only element with a filter
2. **Base shape** — per-element radial gradient (the 3D form)
3. **Gloss overlay** — white radial gradient, masked to shape interior
4. **Specular line** — thin bright stroke offset upward, softly blurred

### Principles

- **No raster filters on main artwork** — filters cause pixelation. Only use filters on shadows and specular lines. Main shapes must be crisp SVG vectors.
- **Per-element gradients** — each shape gets its own `radialGradient` with `gradientUnits="userSpaceOnUse"`. The focal point (`fx`, `fy`) shifts toward the light source (typically upper-left).
- **DRY gradient stops** — define color stops once in a base gradient, then use `href="#base"` on per-element gradients that only override position attributes.
- **Gloss via mask** — white-to-transparent elements are masked to the shape silhouette using `<mask>`. The mask uses a narrower stroke-width than the base shape so gloss stays inside (never touches edges).
- **Specular as separate layer** — thin strokes (2-3px) following the same paths, offset upward via `transform="translate(0, -N)"`, with a gentle blur filter (stdDeviation ~0.8).

## Radial Gradient Configuration

### Base gradient (orb depth)
```xml
<radialGradient id="orbBase">
  <stop offset="0%" stop-color="BRIGHT"/>    <!-- hot spot -->
  <stop offset="55%" stop-color="MID"/>       <!-- body color -->
  <stop offset="88%" stop-color="DARK"/>      <!-- shadow zone -->
  <stop offset="100%" stop-color="RIM"/>      <!-- rim light (slightly brighter than shadow) -->
</radialGradient>
```

The 88%→100% rim lighting simulates light catching the edge of a rounded surface. The very edge should be slightly brighter than the shadow zone just inside it.

### Per-element positioning
```xml
<radialGradient id="g1" href="#orbBase" gradientUnits="userSpaceOnUse"
                cx="CENTER_X" cy="CENTER_Y-12" r="RADIUS"
                fx="CENTER_X-10" fy="CENTER_Y-22"/>
```

- `cx,cy`: slightly above the element's geometric center (simulates top lighting)
- `fx,fy`: shifted ~10px left and ~10px above cx,cy (light source direction)
- `r`: approximately outer-stroke-edge distance from center (element radius + half stroke width)

### Orange palette (proven values)
```
Bright:  #FFD060
Mid:     #FF9200
Dark:    #D87200
Rim:     #E88A20
Shadow:  #805000 at 18% opacity
```

## Gloss Overlay

Per-element white radial gradient circles, positioned in the upper portion of each element:

```xml
<!-- Define once -->
<radialGradient id="glossBase" ...>
  <stop offset="0%" stop-color="#fff" stop-opacity="0.7"/>
  <stop offset="45%" stop-color="#fff" stop-opacity="0.1"/>
  <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
</radialGradient>

<!-- Mask: narrower than base to keep shine inside -->
<mask id="glossMask">
  <use href="#shapes" stroke="white" stroke-width="STROKE-12"/>
</mask>

<!-- Per-element gloss circles inside mask -->
<g mask="url(#glossMask)">
  <circle cx="ELEM_X" cy="ELEM_Y-12" r="RADIUS*0.75" fill="url(#gloss1)"/>
</g>
```

The gloss center should be offset upper-left from the element center, matching the light source direction.

## Specular Lines

Thin bright strokes following the same paths, offset upward:

```xml
<linearGradient id="edgeLight" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#fff" stop-opacity="0.85"/>
  <stop offset="12%" stop-color="#fff" stop-opacity="0.28"/>
  <stop offset="100%" stop-color="#fff" stop-opacity="0.05"/>
</linearGradient>

<filter id="specBlur">
  <feGaussianBlur stdDeviation="0.8"/>
</filter>

<g transform="translate(0, -5)" stroke="url(#edgeLight)" stroke-width="3"
   filter="url(#specBlur)">
  <!-- same paths as base shapes -->
</g>
```

The 0.05 floor opacity ensures specular lines are faintly perceptible even in the darkest areas.

## Drop Shadow

Applied as a separate filtered group — never filter the main shapes:

```xml
<filter id="shadowBlur">
  <feGaussianBlur stdDeviation="2.5"/>
</filter>

<g filter="url(#shadowBlur)" opacity="0.18" transform="translate(0, 4)">
  <use href="#shapes" stroke="#805000" stroke-width="STROKE"/>
</g>
```

## Approaches That Don't Work

- **Single linear gradient across all elements** — looks flat, no per-element depth. Always use per-element radial gradients.
- **Single gloss ellipse spanning all elements** — center elements get more shine than edges. Use per-element gloss instead.
- **Full-shape blur for smoothing gradient seams** — crops edges at filter boundaries and introduces rasterization artifacts on the main artwork.

## Harder Approaches (may improve results, not yet fully explored)

- **SVG lighting filters** (`feDiffuseLighting`, `feSpecularLighting`) — automatically computes per-shape 3D from the alpha channel. Promising for complex shapes but caused pixelation and color shift in testing. Could work with careful parameter tuning, higher filter resolution, or by using lighting only as a masked overlay rather than replacing the base color.
- **Concentric strokes for vignette** (wider dark stroke + narrower bright on top) — produces some depth but the effect is subtle. May work better combined with radial gradients rather than as a replacement.
- **Outer glow via blur** — softens the overall crispness. Could be acceptable at very low stdDeviation (~0.3) or if applied selectively.
- **Filled outline paths** instead of thick strokes — eliminates stroke-bend gradient artifacts and multi-element seams. More work (requires computing boolean union of stroke outlines) but is the correct long-term fix for complex shapes.

## Known Limitations

- **Stroke bend artifacts**: Radial gradients on thick stroked paths create visible contrast lines where the path changes direction (e.g. where a stem meets a curve). Fix: convert to filled outline paths.
- **Multi-element shapes**: When a shape is composed of multiple overlapping stroked elements (e.g. a 'd' made of circle + line), the overlapping gradients create a visible seam. Fix: unify into a single filled path.

## Reference

See `design/logo/cords-wordmark-styled.svg` for a complete working example of this technique applied to letterforms.
