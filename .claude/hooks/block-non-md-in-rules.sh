#!/bin/bash
set -euo pipefail
# Hook: Block non-markdown file edits in rules/

file_path=$(echo "${CLAUDE_TOOL_INPUT:-}" | jq -r '.file_path // empty')

# Only relevant for files in rules/
[[ "$file_path" == */rules/* ]] || exit 0

if [[ "$file_path" != *.md ]]; then
  echo "BLOCK: Only .md files are allowed in rules/" >&2
  exit 1
fi
