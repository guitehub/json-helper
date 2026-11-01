#!/bin/sh
# Construit dist/json-helper-<version>.zip, contenant uniquement les
# fichiers nécessaires à l'extension.
# Usage : ./scripts/package.sh
set -eu

cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
if [ -z "$VERSION" ]; then
  echo "Version introuvable dans manifest.json" >&2
  exit 1
fi

OUT="dist/json-helper-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -q -r "$OUT" manifest.json content.js styles.css icons LICENSE README.md -x '.*'
echo "Paquet créé : $OUT"
