#!/usr/bin/env bash
# Publishes a version: checks the patchnotes, bumps package.json, commits, tags and pushes.
# The « Release » GitHub Action then builds the image and creates the release.
#   scripts/release.sh v2.24
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo "Usage : scripts/release.sh vX.Y[.Z]"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Arbre de travail non propre : committe d'abord."; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] || { echo "Les versions se publient depuis main."; exit 1; }
git tag | grep -qx "$TAG" && { echo "Le tag $TAG existe déjà."; exit 1; }

node scripts/release-notes.mjs "$TAG" > /dev/null   # fails if the patchnotes do not know this version

VERSION="${TAG#v}"; [[ "$VERSION" == *.*.* ]] || VERSION="$VERSION.0"
npm version "$VERSION" --no-git-tag-version --allow-same-version > /dev/null
git add package.json package-lock.json
git commit -qm "chore(release): $TAG" || true
git tag -a "$TAG" -m "$TAG"
git push origin main "$TAG"
echo "✅ $TAG poussé — la CI publie l'image et la release : https://github.com/$(git remote get-url origin | sed -E 's#.*github.com[:/](.*)\.git#\1#')/actions"
