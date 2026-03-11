---
name: new-rule-section
description: Create a new rule section file in rules/ with proper formatting conventions and link it from the master design document
---

# New Rule Section

Create a new rule section markdown file in `rules/`.

## Arguments
- First argument: the rule section name (e.g. "combat", "keywords", "turn-structure")

## Steps

1. **Read** `rules/README.md` to understand existing structure and find the right place to add a link.
2. **Create** `rules/<name>.md` with this template structure:

```markdown
# <Section Title>

<Brief description of what this section covers.>

## <First subsection>

<!-- Use [var:id:baseline_value] for variant-dependent values, e.g. [var:max_hand_size:5] -->
<!-- Use [design:...] for design commentary -->
<!-- Link back to README.md or other rule files where relevant -->
```

3. **Edit** `rules/README.md` to add a link to the new file in the appropriate section, following the same pattern as the existing market.md link:
```markdown
> See [<Section Title>](<name>.md) for full details on ...
```

4. **Confirm** the file was created and linked, and summarize what was added.

## Rules
- Only create `.md` files
- Use `[var:id:baseline_value]` for variant-dependent values
- Use `[design:...]` for design notes
- Do not duplicate content that exists in other rule files — link instead
