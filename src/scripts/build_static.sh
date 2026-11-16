#!/usr/bin/env bash
# Builds the frontend into backend/static/ (vite outDir), the directory the app
# serves and scripts/build_artifact.sh copies into the deploy artifact. The
# frontend is always built locally before a deploy; the Apps runtime builds
# nothing, so this script does not run in the deployed app.
#
#   bash scripts/build_static.sh
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend run build
