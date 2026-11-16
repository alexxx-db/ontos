#!/usr/bin/env bash
# Runs the checks that decide whether this app conforms to the Hello Abacus
# deploy standard, stopping at the first failure. With no argument it runs
# every section. CI names every section so nothing can silently skip.
#
#   bash scripts/check.sh [backend] [frontend] [artifact] [deploy] [migrations]
set -euo pipefail

cd "$(dirname "$0")/.."

backend() {
  uv sync --locked
  uv run ruff check backend
  uv run ruff format backend --check
  uv run pytest
}

frontend() {
  pnpm --dir frontend install --frozen-lockfile
  pnpm --dir frontend run lint
  pnpm --dir frontend run test:run
  # The build runs tsc, the only type check, and writes backend/static/.
  pnpm --dir frontend run build
}

# Needs the frontend build in backend/static/, so it runs after frontend.
artifact() {
  bash scripts/build_artifact.sh
  bash scripts/check_artifact.sh
}

# The Seiji hooks and the CLI fetch, against stand-ins for aws, seiji, databricks and curl.
deploy() {
  bash deploy/test_hooks.sh
  bash scripts/test_fetch.sh
}

# Alembic stays in the app for local dev, but its history must stay single-head
# (see .cursor/rules/11-database-migrations.mdc) and env.py must import under
# the app's own env.
migrations() {
  heads="$(cd backend && uv run alembic heads | grep -c .)"
  [ "$heads" = "1" ] || { echo "Alembic has $heads heads; merge them before deploying." >&2; exit 1; }
  (cd backend && PYTHONPATH=. uv run python -c "import src.common.database")
  echo "Alembic history is single-head and env imports resolve."
}

if [ "$#" -eq 0 ]; then
  backend
  frontend
  artifact
  deploy
  migrations
  exit 0
fi

for section in "$@"; do
  case "$section" in
    backend | frontend | artifact | deploy | migrations) "$section" ;;
    *)
      echo "Unknown section: $section. Use backend, frontend, artifact, deploy, or migrations." >&2
      exit 2
      ;;
  esac
done
