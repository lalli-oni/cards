# Card Image Renderer — Proposal

## Goal

Build a tool that reads card data from the library CSVs, renders each card
with a visual template, and exports composited PNG images. This replaces an
external design tool (Figma) with an in-repo, code-driven pipeline.

The exported images serve multiple purposes:

- Print-and-play prototyping
- Web client card display
- Social media / marketing assets
- Visual reference during playtesting

---

## Approaches Considered

### 1. Figma + MCP

Use Figma as the design tool, driven programmatically via the Figma MCP
server.

**Pros:**
- Best-in-class visual design tooling (gradients, effects, typography)
- WYSIWYG editing — designers can tweak layouts directly
- Figma's component/variant system maps well to card types and rarities
- Collaboration features (comments, version history)

**Cons:**
- Requires a paid Figma plan for meaningful MCP access (free tier: 6 calls/month)
- External dependency — designs live outside the repo
- Fragile automation — MCP API may change, rate limits apply
- No offline workflow
- Batch export requires scripting against the Figma API anyway
- Card data and card visuals are in two different systems

**Verdict:** Not viable for this project given current plan constraints.

---

### 2. HTML/CSS + Headless Browser → PNG

Render cards as styled HTML pages, then screenshot them with a headless
browser (Playwright or Puppeteer) to produce PNGs.

**Pros:**
- Maximum design flexibility — full CSS (gradients, shadows, blend modes, custom fonts, flexbox/grid layout)
- Live preview in any browser during development
- Familiar tech stack — HTML/CSS is widely known
- Hot-reload workflow: edit template → see result instantly in browser
- Can reuse templates in a web client directly
- Rich ecosystem of CSS frameworks and utilities

**Cons:**
- Headless browser is a heavy dependency (~150 MB for Chromium)
- Rendering speed: launching a browser + screenshotting is slow for batch export (hundreds of cards)
- Cross-platform font rendering differences can cause subtle inconsistencies
- Browser rendering is a black box — harder to get pixel-perfect control
- Screenshot-based export can have anti-aliasing artifacts at certain sizes

**Dependencies:**
| Package      | Purpose                         | Size    |
|--------------|---------------------------------|---------|
| `playwright` | Headless browser for PNG export | ~150 MB (Chromium only) |

Bun's built-in `Bun.serve()` handles the dev server — no additional
framework needed.

---

### 3. SVG Templates → PNG

Define card layouts as SVG templates, populate them with card data, then
rasterize to PNG.

**Pros:**
- Resolution-independent — cards look crisp at any export size
- SVG is a well-defined standard with precise coordinate control
- Lightweight — no browser runtime needed
- Templates are plain text (XML) — version control friendly
- Good for geometric/clean card aesthetics

**Cons:**
- SVG text layout is primitive — no automatic line wrapping, no flexbox, manual positioning required
- Complex designs (layered effects, rich typography) are tedious in raw SVG
- Fewer developers are fluent in SVG authoring compared to HTML/CSS
- Hard to preview interactively (no hot-reload like a browser)
- SVG filters/effects are less capable than CSS

**Dependencies:**
| Package    | Purpose                      | Size   |
|------------|------------------------------|--------|
| `resvg-js` | SVG-to-PNG rasterizer (Rust) | ~5 MB  |

---

### 4. Penpot (self-hosted) + MCP

Open-source design tool (AGPL). Self-hostable, browser-based, SVG-native.
Has an API with access tokens and webhooks. An MCP server
([penpot-mcp](https://github.com/montevive/penpot-mcp)) enables
programmatic access from Claude Code and other AI tooling.

**Pros:**
- WYSIWYG design UI — closest to the Figma experience, but free
- Structured design: components, design tokens, Flex Layout, layers
- SVG-native — designs are resolution-independent and inspectable
- API + MCP server — programmatic read/write of design files
- Self-hosted — no API call limits, no vendor lock-in, works offline
- Design-as-code philosophy — granular programmatic access to every element
- Can export to SVG, PNG, PDF
- Component/variant system for card types and rarities

**Cons:**
- Self-hosting adds infrastructure (Docker Compose stack)
- Smaller ecosystem and community than Figma
- MCP server is community-maintained, not official (may lag behind API changes)
- Less polished UI and fewer plugins compared to Figma
- Export pipeline still needs scripting for batch card generation
- Web client reuse requires an export step (SVG/CSS extraction), not direct like HTML/CSS

**Dependencies:**
| Component | Purpose | Notes |
|-----------|---------|-------|
| Penpot (Docker) | Design tool | Self-hosted via `docker compose` |
| `penpot-mcp` | MCP bridge for AI tooling | Community package |

---

### ~~5. Canvas API~~ (rejected)

Imperative pixel drawing with a server-side canvas library. Rejected
because every advantage (no browser, fast batch, pixel control) is
better served by SVG + resvg-js, while the authoring experience is
significantly worse — manual coordinate math, no declarative layout,
no live preview. Not a viable path for iterating on card designs.

---

## CSS Tooling

Relevant if we go with HTML/CSS (Approach 2). Less relevant for Penpot
(Approach 4) where styling lives in the design tool.

If we use HTML/CSS, we want structured styling that

If we go with HTML/CSS (Approach 2), we want structured styling that
gives us organizational benefits similar to a design tool: design tokens,
reusable components, layered composition. Raw CSS can do this but
provides no guardrails. Options:

### Vanilla Extract

Design tokens and themes defined in **TypeScript**, compiled to static
CSS at build time. Closest to Figma's variables system.

- Type-safe token references — IDE autocomplete, compile errors on typos
- Themes and variants as typed objects (e.g. rarity themes, card type layouts)
- Zero runtime — generates plain CSS
- Requires a build step (Vite or esbuild plugin)

### UnoCSS

On-demand atomic CSS generator. Like Tailwind but lighter and more
configurable — you define only the rules you need.

- Custom rules for card-specific utilities (e.g. `card-legendary`, `stat-high`)
- No unused CSS — only generates what templates reference
- Supports design tokens via theme config
- Lighter than Tailwind — doesn't ship a full utility framework
- Less type safety than Vanilla Extract

### Tailwind CSS

Full utility-first CSS framework. Well-documented, large ecosystem.

- Design tokens via `tailwind.config` (colors, spacing, typography)
- Component patterns via `@apply` or class composition
- Brings a lot of unused baggage for fixed-size card templates (responsive
  utilities, breakpoints, container queries)
- Verbose class strings for complex layouts

### CSS Custom Properties (vanilla)

Define tokens as `--var` in a theme file, use native CSS nesting for
structure.

- Zero dependencies, zero build step
- No guardrails — typos in variable names fail silently
- Relies on discipline rather than tooling

### Recommendation

**Vanilla Extract** if we want Figma-like structure with type safety —
tokens, themes, and variants are all code, errors are caught at build
time. **UnoCSS** if we want lighter tooling with custom card-specific
utilities and are comfortable without type-checked tokens.

---

## Recommendation

Investigate **Penpot** (Approach 4) first. It offers the structured design
experience we wanted from Figma — WYSIWYG editing, components, design
tokens, layers — without the paid tier limitation. The API and MCP server
enable programmatic batch export driven by card library data.

**HTML/CSS + Playwright** (Approach 2) is the fallback if Penpot proves
too heavy to self-host or the API/MCP tooling is too immature for our
batch export needs. It trades the visual design UI for direct web client
reuse and a familiar tech stack.

### Investigation Steps

#### Phase 1: Penpot viability (start here)
- [ ] Run Penpot locally via Docker Compose — assess startup time and resource usage
- [ ] Design a single unit card template in the Penpot UI — evaluate the component/token system
- [ ] Set up penpot-mcp and connect from Claude Code — test reading/writing design elements
- [ ] Script batch export: populate a card template with library data via API, export PNG
- [ ] Evaluate SVG output quality — can exported SVGs be used in a web client?

#### Phase 2: Decide or fall back
- [ ] If Penpot works: define component structure for all 5 card types, build export pipeline
- [ ] If Penpot doesn't work: prototype the same unit card in HTML/CSS, compare authoring effort
- [ ] If falling back to HTML/CSS: compare Vanilla Extract vs UnoCSS for token/theme structure

#### Phase 3: Build pipeline
- [ ] Batch export all cards from chosen approach
- [ ] Measure export quality at target dimensions (e.g. 750x1050px)
- [ ] Verify output consistency across card types and rarities
- [ ] Integrate export into the build workflow (`bun run export-cards` or similar)
