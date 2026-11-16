#!/usr/bin/env bash
# Builds app_artifact/, the directory every target deploys as the app. It holds the
# backend package, its Alembic migrations, the built frontend in backend/static/,
# each backend dependency as a wheel for the Apps runtime (CPython 3.11 on Linux
# x86_64), and a requirements.txt that the Apps container installs with no
# package index. Customer workspaces block PyPI, so nothing the app needs may be
# fetched after this script runs.
#
#   bash scripts/build_artifact.sh
#
# Run it after the frontend build, which writes backend/static/. Resolving and
# downloading need a package index, so this runs on a machine with index access:
# a laptop or CI.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT=app_artifact
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

test -f backend/static/index.html || { echo "backend/static/ is missing; build the frontend first (bash scripts/build_static.sh)." >&2; exit 1; }

# Empty the directory but keep it: git tracks it through .gitkeep.
find "$OUT" -mindepth 1 ! -name .gitkeep -exec rm -rf -- {} +
mkdir -p "$OUT/wheels"

# The locked runtime dependencies, resolved for the Apps platform so no
# environment marker is left for the container to evaluate.
uv export --frozen --no-dev --no-hashes --no-header --no-annotate \
  --output-file "$WORK/locked.txt" >/dev/null
uv pip compile "$WORK/locked.txt" --python-version 3.11 --python-platform x86_64-manylinux_2_28 \
  --no-header --no-annotate --quiet --output-file "$WORK/resolved.txt"

uvx --python 3.11 --from pip==25.3 pip download --quiet --disable-pip-version-check --no-deps \
  --only-binary=:all: --implementation cp --python-version 3.11 \
  --abi cp311 --abi abi3 --abi none \
  --platform manylinux_2_28_x86_64 --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64 --platform any \
  --dest "$OUT/wheels" --requirement "$WORK/resolved.txt"

{
  echo "--no-index"
  echo "--find-links ./wheels"
  cat "$WORK/resolved.txt"
} > "$OUT/requirements.txt"

# Source without tests or caches. The app runs `python backend/src/app.py` with
# PYTHONPATH=./backend, so the artifact keeps the backend/ shape. Alembic ships
# with the bundle: the migrate job runs it from the synced copy.
mkdir -p "$OUT/backend"
cp -R backend/src "$OUT/backend/src"
cp -R backend/alembic "$OUT/backend/alembic"
cp backend/alembic.ini "$OUT/backend/alembic.ini"
find "$OUT/backend" \( -name __pycache__ -o -name "test_*.py" -o -name tests -type d \) -prune -exec rm -rf -- {} +
cp -R backend/static "$OUT/backend/static"

echo "Built $OUT/: $(find "$OUT/wheels" -name '*.whl' | wc -l | tr -d ' ') wheels."
