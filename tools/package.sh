#!/usr/bin/env bash
# Builds a clean, deployable copy of the static site into dist/ (no git data,
# no tooling) and a zip next to it. Usage: tools/package.sh
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/power-striker
tar --exclude=./dist --exclude=./.git --exclude=./tools --exclude=./.github \
    --exclude=./PLAN.md --exclude=./AGENTS.md -cf - . | tar -xf - -C dist/power-striker
(cd dist && zip -qr power-striker.zip power-striker)
echo "Built dist/power-striker/ and dist/power-striker.zip"
