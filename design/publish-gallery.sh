#!/usr/bin/env bash
# Build the card gallery and publish it to the orphan `gh-pages` branch (which
# GitHub Pages serves). Keeps the generated card PNGs off `main` — they live only
# on gh-pages. Run whenever the cards change:  bash design/publish-gallery.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"                 # design/
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
GALLERY="$HERE/gallery"
TMP="$(mktemp -d)"
WT="$TMP/gh-pages"
trap 'git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

python3 "$HERE/build-gallery.py"

# Ensure a gh-pages branch exists locally. Prefer an existing remote branch so we
# don't create a divergent orphan that the non-fast-forward push would reject.
if ! git -C "$REPO" rev-parse --verify -q gh-pages >/dev/null; then
  if git -C "$REPO" ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
    git -C "$REPO" fetch -q origin gh-pages
    git -C "$REPO" branch gh-pages FETCH_HEAD
    echo "tracked existing remote gh-pages branch"
  else
    empty="$(git -C "$REPO" mktree < /dev/null)"      # empty tree -> no shared history
    c="$(git -C "$REPO" commit-tree "$empty" -m 'init gh-pages')"
    git -C "$REPO" branch gh-pages "$c"
    echo "created orphan gh-pages branch"
  fi
fi

git -C "$REPO" worktree add --force "$WT" gh-pages >/dev/null

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
