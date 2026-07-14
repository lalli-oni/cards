#!/usr/bin/env bash
# Build the card gallery and publish it to the orphan `gh-pages` branch (which
# GitHub Pages serves). Keeps the 66 card PNGs off `main` — they live only on
# gh-pages. Run whenever the cards change:  bash design/publish-gallery.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"                 # design/
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
GALLERY="$HERE/gallery"
WT="$(mktemp -d)/gh-pages"

python3 "$HERE/build-gallery.py"

# Ensure an orphan gh-pages branch exists (empty tree -> no shared history).
if ! git -C "$REPO" rev-parse --verify -q gh-pages >/dev/null; then
  empty="$(git -C "$REPO" mktree < /dev/null)"
  c="$(git -C "$REPO" commit-tree "$empty" -m 'init gh-pages')"
  git -C "$REPO" branch gh-pages "$c"
  echo "created orphan gh-pages branch"
fi

git -C "$REPO" worktree add --force "$WT" gh-pages >/dev/null
trap 'git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT

# Replace the worktree contents with the freshly built gallery.
find "$WT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$GALLERY"/. "$WT"/
touch "$WT/.nojekyll"                                 # serve files as-is (no Jekyll)

git -C "$WT" add -A
if git -C "$WT" diff --cached --quiet; then
  echo "gallery unchanged — nothing to publish"
else
  git -C "$WT" commit -q -m "Publish card gallery"
  git -C "$WT" push -q origin gh-pages
  echo "published gallery to gh-pages"
fi
