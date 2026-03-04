This file is to provide LLM for context and instructions when working within `rules/`. This is a meta file and not part of the rule definitions.

This folder and all ancestors is for markdown files that define the rules for this card game.

Do not consider code or implementation unless specificly asked to.

Focus on game development considerations.

Be critical and ask user questions for clarification.

## Editing
Only create or modify .md files.

Avoid duplication of rules or definitions.

Any values that can be affected by variants should be written in a format of `[var:5]` to indicate this is the baseline value, but can be different in other variants.

Anything that is not strictly rules (for example: design comments, interactions to be aware of) should be wrapped in `[design:...]`.

When sections become long or overly specific split that rule section into a different .md file. Write the specific rule there and add a link in the original file.
