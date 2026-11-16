# Hello Abacus Deployment and Dependency Alignment

**Date**: 2026-07-14
**Context**: Ontos adopted `hello-abacus` (`specs/hello-abacus-develop.zip`) as the
standard for Databricks App deployment and dependency management. This records
what changed and what was deliberately kept.

## Decisions

| Area | Decision |
|---|---|
| Python deps | `uv` + `src/pyproject.toml` (exact `==` pins) + `src/uv.lock`. Dev and e2e extras live in `dependency-groups`. Requirements `.in`/`.txt` files and hatch envs removed. |
| Python version | `>=3.11,<3.12`, matching the Databricks Apps CPython 3.11 runtime. |
| Frontend deps | `pnpm` + `pnpm-lock.yaml` + `pnpm-workspace.yaml` (`allowBuilds`, `minimumReleaseAge`). npm/`package-lock.json` removed. |
| Frontend build | Vite builds into `backend/static/` before deploy. The Apps runtime builds nothing. |
| Deploy artifact | `app_artifact/` holds backend source, `backend/static/`, vendored CPython 3.11 Linux x86_64 wheels, and a `requirements.txt` starting with `--no-index` and `--find-links ./wheels`. Built by `src/scripts/build_artifact.sh`, proven offline by `src/scripts/check_artifact.sh`. |
| Bundle | `src/databricks.yml` + `src/resources/*.yml` (app, lakebase, warehouse, unity_catalog, migrate). The bundle creates the Lakebase project/branch/database/endpoint/role, SQL warehouse, UC schema and volume, the migrate job, and the app. `app.yaml` and `manifest.yaml` removed; env config lives in `resources/app.yml`. |
| Migrations | Alembic kept (not Atlas). A `migrate` bundle job runs `init_db()` (ensure database/schema, then `alembic upgrade head`) before the app: deploy → migrate → run. App startup keeps its existing idempotent revision check as a safety net for dev; after the job runs it is a no-op. |
| Customer deploys | Seiji packaging: `src/seiji-packaging.yaml`, `src/deploy/` hooks (`create`, `destroy`, `lib`, `test_hooks`), `deploy/luna-*.yaml`. `scripts/fetch_databricks_cli.sh` pins and checksums the CLI. |
| Conformance | `src/scripts/check.sh` runs backend, frontend, artifact, deploy-hook, and migration checks. |
| Access | App access is group-based (`${var.app_user_group}` etc.) rather than the `users` group. |

## Learned from the first abacus deployment attempt (2026-11-16)

- `app_source_code_path` resolves relative to the resource file using it
  (`resources/app.yml`), so its default is `../app_artifact`, not `./`.
- The app service principal needs an explicit CAN_USE entry in the warehouse's
  own `permissions` list, or a later deploy removes the app resource's grant.
- Side-by-side dev copies need their own target (`dev-abacus`): distinct bundle
  root, name suffix, viewer-group override, UC schema name (`uc_schema`) and
  app admin groups (`app_admin_groups`).
- `dev-abacus` uses a check-only artifact build so it can deploy from a
  workspace that has no package-index egress or pnpm.
- Open risk: the Apps runtime's Databricks-managed Python constraints can reject
  exact pins. If a deployment fails at package install, read `<app-url>/logz`
  and relax the conflicting pins, then re-lock and rebuild.
- The app's groups need `USE CATALOG` on the catalog; the bundle only grants
  schema and volume privileges. On a non-standard catalog (not
  `<label>_<workspace>_catalog`) that grant is manual.

## Not decided here

- CI platform: Ontos stays on GitHub Actions; hello-abacus uses GitLab + souschef.
  The GitHub workflows were converted to uv/pnpm rather than re-platformed.
- Architecture: hello-abacus uses vertical slices + ports (ADR-0002). Ontos keeps
  its controller/repository/manager structure; that is a separate decision.
- The docs website (`website/`) still uses npm and is outside the app artifact.
- `prd` target deploys from the committed working tree here; the Seiji hook is
  what enforces artifact presence for customer deploys.
