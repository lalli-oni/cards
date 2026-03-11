#!/bin/bash
# Hook: Block non-markdown file edits in rules/
# Ensures only .md files are created or modified in the rules/ directory.

if echo "$CLAUDE_TOOL_INPUT" | grep -q '"file_path".*rules/' && \
   ! echo "$CLAUDE_TOOL_INPUT" | grep -q '\.md"'; then
  echo "BLOCK: Only .md files are allowed in rules/"
  exit 1
fi
