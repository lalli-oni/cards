#!/bin/bash
set -euo pipefail
# Hook: Block non-markdown file edits in rules/

file_path=$(echo "$CLAUDE_TOOL_INPUT" | jq -r '.file_path // empty')

if [[ "$file_path" == rules/* ]] && [[ "$file_path" != *.md ]]; then
  echo "BLOCK: Only .md files are allowed in rules/" >&2
  exit 1
fi
