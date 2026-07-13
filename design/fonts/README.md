# Vendored card fonts

Fonts used by the Modern Trek card renderer, vendored in-repo so the Penpot
exporter renders them from `/usr/share/fonts` (mounted via `docker-compose.yaml`)
with **no external fetch** at render time.

Both are licensed under the SIL Open Font License 1.1 (see each `OFL.txt`).

## space-grotesk/
- **Space Grotesk** by Florian Karsten — https://github.com/floriankarsten/space-grotesk
- Copyright 2020 The Space Grotesk Project Authors. OFL-1.1.
- Upstream ships a single variable font (`SpaceGrotesk[wght].ttf`, wght 300–700).
  The static weights here (Medium 500, SemiBold 600, Bold 700) were instanced
  from it with `fontTools.varLib.instancer` and given a consistent typographic
  family name ("Space Grotesk") so fontconfig/CSS weight selection resolves.

## jetbrains-mono/
- **JetBrains Mono** v2.304 — https://github.com/JetBrains/JetBrainsMono
- Copyright 2020 The JetBrains Mono Project Authors. OFL-1.1.
- Static TTFs (Regular 400, Bold 700, ExtraBold 800) taken from the upstream release.

## Regenerating / adding weights
Space Grotesk statics are derived from the variable font. To re-instance a weight:

```python
from fontTools import ttLib
from fontTools.varLib.instancer import instantiateVariableFont
f = ttLib.TTFont("SpaceGrotesk[wght].ttf")
instantiateVariableFont(f, {"wght": 600}, inplace=True)
# then set name IDs 1/2/4/6/16/17 to a consistent "Space Grotesk" family + weight
```
