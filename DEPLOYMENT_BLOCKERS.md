# abacus-ontos: deployment blockers, bugs and open issues

Status as of 2026-11-17. Covers deploying this repo's bundle (`src/databricks.yml`, bundle name `ontos`) to the `demo-build` workspace (`dbc-fb7dab4f-d795.cloud.databricks.com`) as a separate copy next to the existing `ontos-alex-baretto` app.

Active deploy target: **`dev-v2`**, which bakes in `customer=demo`, `workspace=build` and `catalog=genie_agents`, so it needs no `--var` flags. Its resources are named `ontos-v2-alex-baretto`. `dev-abacus` (from 2026-11-16) is still in the bundle and validates, but it hasn't been deployed.

The summary table and "Progress on 2026-11-17" are current. The per-issue sections further down are the original 2026-11-16 write-up. Where they disagree with the summary, the summary wins.

Every item is marked with how it was established:

* **Verified**: checked against the workspace or repo on 2026-11-16 (bundle validate, Unity Catalog grants, Apps API, file contents).
* **Earlier finding**: observed in an earlier session the same day and not re-run for this write-up.
* **Risk**: likely to fail but not tested, because nothing has been deployed yet.

---

## Summary

| # | Issue | Severity | Status (2026-11-17) |
| --- | --- | --- | --- |
| **W** | **You can't create SQL warehouses (403), so the app can't be created** | **Blocker** | **Open, waiting on an admin** ([admin_request_sql_warehouse.md](admin_request_sql_warehouse.md)) |
| 1 | `app_artifact/` is empty: the app has never been built | Blocker | **Worked around**: built offline in the workspace with `scripts/build_artifact_offline.py` |
| 2 | No `uv.lock`: `build_artifact.sh` can't run | Medium (was Blocker) | Open: worked around by resolving from the volume wheel cache |
| 3 | The workspace can't reach PyPI or npm | Blocker | **Worked around**: dependency caches in volumes |
| 4 | `pnpm` isn't installed in the workspace | Blocker | **Worked around**: `dev-v2` and `dev-abacus` build hooks only check for a prebuilt artifact |
| 5 | The app's groups have no `USE CATALOG` on `genie_agents` | Blocker (app unusable after deploy) | Open: you run the grants yourself; the assistant isn't allowed to run them |
| 6 | Package installation fails on the existing app (`ontos-alex-baretto`) | Likely blocker | Open: can't test the new copy until W is fixed |
| 7 | In-app admins default to the `admins` group | High | **Fixed**: `app_admin_groups` variable, overridden in `dev-v2` and `dev-abacus` |
| 8 | The migrate job's serverless environment may not install packages without egress | Risk | **Fixed and verified**: migration succeeded |
| 9 | Permission to create a Lakebase project and SQL warehouse is unconfirmed | Risk | Lakebase: **works**. Warehouse: **fails** (see W) |
| 10 | The `prd` target can't be validated or deployed by this user | Medium | Open (out of scope for dev) |
| 11 | The UC schema name isn't suffixed | Low | **Fixed upstream**: `uc_schema` variable; `dev-abacus` uses `app_ontos_abacus` |
| 12 | Indirect PyPI dependencies are unknown | Low | Partly resolved: offline resolution gives 98 packages (without mlflow); still no `uv.lock` |
| 13 | Harmless `bundle validate` warnings (sync patterns) | Cosmetic | Open |
| N1 | All 120 Lakebase tables are owned by you, not by the app's service principal | High | Open: needs grants once the app's service principal exists |
| N2 | The migrate job's offline wheels are x86_64 only | Risk | Open: an aarch64 serverless run would fail to install |
| N3 | The app's 10 MB file limit is worked around by splitting wheels and dropping source maps | Note | By design for `dev-v2`; check on first app start |
| N4 | The offline build steps aren't in the repo | Medium | **Fixed**: `src/scripts/build_artifact_offline.py`; its output is byte-identical to the hand-built artifact |
| F1 | `app_source_code_path` resolved to `resources/app_artifact` | Bug | **Fixed** |
| F2 | A `dev` deploy would take over `ontos-alex-baretto` | Bug for this use | **Fixed** (`dev-abacus`, then `dev-v2`) |
| F3 | The `demo-build-ontos-viewer` group doesn't exist | Blocker | **Worked around** in `dev-abacus` and `dev-v2` |
| F4 | The app service principal is missing from the warehouse permissions | Bug | **Fixed** |
| F5 | `jobs/migrate.py` called `init_db()` before `init_config()` | Bug | **Fixed** |
| F6 | `database.py` rejected a user email as the Postgres role | Bug | **Fixed** |
| F7 | The migrate job didn't install `email-validator` (pydantic `EmailStr`) | Bug | **Fixed** |

Remaining path to a working app: W (admin) → #5 grants (you) → `bundle deploy -t dev-v2` → start the app and check #6 and N3 → grant the app's service principal access to the tables (N1).

## Progress on 2026-11-17

All changes below are pushed to `feat/hello-abacus`, except the artifact itself: `src/app_artifact/` is gitignored.

### Dependency caches (#3)

* npm: `/Volumes/genie_agents/internal/npm/abacus-ontos/npm/tarballs/` has 957 tarballs (179 MB). Five `*-cjs` alias targets have no tarball; the build doesn't need them.
* Python: `/Volumes/genie_agents/internal/libraries/abacus-databricks-genie-workbench/abacus-ontos-python/abacus-ontos/python/wheels/` has 134 wheels (213 MB). They're byte-identical to the older copy in `/Volumes/genie_agents/internal/libraries/abacus-ontos/python/wheels/`.

### Offline artifact build (#1, #4, N4)

Reproduce it with `src/scripts/build_artifact_offline.py` (about 2 minutes on serverless), run from `src/`:

```
python scripts/build_artifact_offline.py \
  --npm-tarballs /Volumes/genie_agents/internal/npm/abacus-ontos/npm/tarballs \
  --wheels /Volumes/genie_agents/internal/libraries/abacus-databricks-genie-workbench/abacus-ontos-python/abacus-ontos/python/wheels
```

It writes `src/app_artifact/` and fails if any check below doesn't hold. A test run into a scratch folder produced the same 1,001 files as the hand-built artifact, byte for byte.

* **Frontend:** `node_modules` was installed from `frontend/pnpm-lock.yaml` and the npm tarballs, in a hoisted layout (1,177 package instances). A separate Node resolver checked that all 3,219 dependency links resolve to the exact locked versions. `vite build` then succeeded.
* **Python:** resolved offline for CPython 3.11 / manylinux x86_64 to 98 packages. `mlflow` was dropped: the backend never imports it, and it pulled in 36 packages, including `scipy`. Every third-party import in `backend/src` is shipped, except `pyspark` (job workflows only) and `fuzzywuzzy` (not installed upstream either).
* **10 MB Apps file limit (N3):**
  * `numpy`, `pandas` and `pyarrow` ship as 9 MB parts in `big_wheels/`. `bootstrap.sh` joins them back together (checked byte-identical with sha256), installs them offline with `databricks-sql-connector` and `databricks-sqlalchemy`, then runs `backend/src/app.py`.
  * `dev-v2` sets `app_command: ["bash", "bootstrap.sh"]`; other targets keep `python backend/src/app.py`.
  * Source maps (`*.map`, including a 15 MB one) are left out.
* **Result:** `src/app_artifact/` has 1,001 files, 149 MB, and the largest file is 9.0 MB. Simulated offline installs: `requirements.txt` gives 93 packages, and adding the `bootstrap.sh` step gives all 98.

### Migration job (#8, F5–F7)

* `migrate_dependencies` is now a variable. `dev-v2` installs with `--no-index --find-links <volume wheels>` and adds `email-validator==2.4.0`.
* `jobs/migrate.py` calls `init_config()` before `init_db()`.
* `backend/src/common/database.py` now checks the Postgres role as a quoted identifier (no `"`, no NUL, at most 63 bytes), so a person's email works as well as a service principal UUID. Every SQL use of the role is double-quoted.
* Run `974942756111802` succeeded. Checked directly in Lakebase: `app.app_ontos` has 120 tables, and `alembic_version` is `c5_merge_cv2_b8`, the only head in the repo.

### `dev-v2` deploy (partial)

* **Created:**
  * Lakebase project `ontos-v2-alex-baretto` (`production` branch, `primary` endpoint at 0.5 CU, `app` database)
  * Unity Catalog schema `genie_agents.dev_alex_baretto_app_ontos`, with its `app_files` volume and grants
  * Migrate job `796097008501293`
* **Not created:**
  * The SQL warehouse: `not authorized to create SQL Endpoint` (403)
  * As a result, the app and the app and warehouse permissions
* **Existing warehouses:** you have no CAN MANAGE on `demo-genesis-warehouse`, `Serverless Starter Warehouse` or `replit-warehouse`.
* **Cost while blocked:** the Lakebase endpoint has a 0.5 CU minimum, so it may cost money while the app waits on W.

### Other changes

* Merged upstream into `feat/hello-abacus`. That brought the `uc_schema` and `app_admin_groups` variables, and kept upstream's `dev-abacus` target.
* `dev-v2` sets `app_admin_groups: '["admins", "demo-build-implementation"]'` (#7).
* Drafted [admin_request_sql_warehouse.md](admin_request_sql_warehouse.md) for W. It hasn't been sent. Option A, preferred: an admin creates `ontos-v2-alex-baretto` and gives you CAN MANAGE, then you bind it with `bundle deployment bind`. Whether `bind` supports SQL warehouses hasn't been confirmed; if it doesn't, point `dev-v2` at the warehouse ID.

---

## Open blockers

### 1. `app_artifact/` is empty: the app has never been built

**Verified.** `src/app_artifact/` contains only `.gitkeep`. The source code isn't built either: `src/backend/static/` and `src/frontend/node_modules/` don't exist.

The app resource deploys `app_artifact/` as its source code (`source_code_path: ${var.app_source_code_path}`, default `../app_artifact`). The Apps container then runs `python backend/src/app.py` after installing `requirements.txt` from `./wheels` with no package index. An empty artifact would deploy a folder with no `requirements.txt` and no `backend/`, so the app fails at start-up.

`scripts/build_artifact.sh` builds the artifact, and it expects the frontend to be built first (it checks for `backend/static/index.html`). The full sequence the `dev`/`dev-abacus` targets run is:

```
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend run build          # writes backend/static/
bash scripts/build_artifact.sh          # writes app_artifact/
```

**Fix:** run that sequence on a machine with PyPI and npm access (#3), with a `uv.lock` in place (#2). Optionally prove the result installs offline with `bash scripts/check_artifact.sh`. Then either deploy from that machine, or copy `app_artifact/` into `src/app_artifact/` in the workspace.

### 2. No `uv.lock`

**Verified.** Neither `src/uv.lock` nor `uv.lock` exists. Both scripts depend on it:

* `build_artifact.sh` runs `uv export --frozen ...`, and `--frozen` fails if there is no lock file.
* `check_artifact.sh` checks every wheel's sha256 against `../uv.lock`.

`pyproject.toml` says direct dependencies are pinned exactly and that indirect versions "live in uv.lock", so the repo expects a lock file to be committed.

**Fix:** on a machine with PyPI access, run `uv lock` in `src/` and commit `src/uv.lock` to `feat/hello-abacus`. CPython 3.11 is required (`requires-python = ">=3.11,<3.12"`).

### 3. The workspace can't reach PyPI or npm

**Earlier finding.** Serverless compute here has no DNS for `pypi.org` or `registry.npmjs.org`. Classic cluster `1112-162116-297ysjlg` resolves them, but its HTTPS connections time out. I didn't repeat the network check for this write-up.

This matches the repo's design: `build_artifact.sh` says customer workspaces block PyPI and that the artifact must be built "on a machine with index access: a laptop or CI". The `prd` target doesn't build at all; Seiji copies a CI-published artifact in from S3 (`deploy/lib.sh`).

**Consequence:** #1 and #2 can't be fixed from inside this workspace.

### 4. `pnpm` isn't installed in the workspace

**Verified.** On workspace serverless, `uv` and `node` exist in `/usr/local/bin`, but `pnpm` and `npm` don't. The `dev` and `dev-abacus` targets define an `artifacts.app_artifact.build` hook that runs `pnpm ...`. `databricks bundle deploy` runs this hook on the machine doing the deploy, so a deploy started from the workspace (web terminal, notebook shell, or the CLI on serverless) fails at the build step even after #2 is fixed. Even with `pnpm` installed, #3 would stop it from downloading anything.

**Fix:** deploy from a laptop or CI. To deploy from the workspace with an artifact built elsewhere, you'd need a target whose build hook only checks that the artifact exists, like `prd` does (`test -f app_artifact/requirements.txt || ...`). That would be a new change.

### 5. The app's groups have no `USE CATALOG` on `genie_agents`

**Verified.** Catalog-level grants on `genie_agents`:

* `account users`: BROWSE only
* `alex.baretto@`, `paul.may@`: ALL PRIVILEGES and MANAGE
* Several individual users and four service principals: USE CATALOG
* **No grants** to `demo-build-implementation`, `demo-build-admin` or `demo-admin`

The bundle grants `USE_SCHEMA` and `SELECT` on the app schema and `READ_VOLUME`/`WRITE_VOLUME` on `app_files` to the viewer, implementer and admin groups. Without `USE CATALOG` on the catalog, those grants have no effect.

The app reads Unity Catalog as the signed-in user (`user_api_scopes` includes `sql` and `catalog.*:read`). Members of those groups who aren't individually granted would get permission errors in any feature that reads the app schema or volume.

The bundle comment in `resources/unity_catalog.yml` assumes "the admin groups already hold ALL_PRIVILEGES on the catalog" and that "USE CATALOG on the catalog is its owner's to grant". That holds for the standard `<label>_<workspace>_catalog` (for example `demo_build_catalog`), not for `genie_agents`.

**Fix** (you have MANAGE on `genie_agents`; not run):

```sql
GRANT USE CATALOG ON CATALOG genie_agents TO `demo-build-implementation`;
GRANT USE CATALOG ON CATALOG genie_agents TO `demo-build-admin`;
GRANT USE CATALOG ON CATALOG genie_agents TO `demo-admin`;
```

This gives no data access by itself, but it does let those groups reach any schema in `genie_agents` where they already hold grants. The other option is to deploy into `demo_build_catalog`, where the groups already have catalog access. `demo-build-implementation` has USE CATALOG there, but you don't have READ METADATA or create rights there, so that route needs an admin.

### 6. Package installation fails on the existing app

**Verified (history); root cause not confirmed.** All six deployments of `ontos-alex-baretto` (the older copy of this codebase, from `.bundle/ontos/dev/files`) failed:

| Deployment | Created (UTC) | Failure |
| --- | --- | --- |
| `01f1df69…6f081` | 2026-11-13 13:49 | Package installation failed with Databricks-managed Python constraints enabled. Check build logs for dependency conflicts or other installer errors. |
| `01f1dc6a…d52bb` | 2026-11-09 18:24 | Error installing packages. Please check /logz for more details |
| `01f1dc5d…a7778` | 2026-11-09 16:46 | Error installing packages. Please check /logz for more details |
| `01f1d7d1…ebabb` | 2026-11-03 21:55 | Error installing packages. Please check /logz for more details |
| `01f1d7cc…6c9cdf8` | 2026-11-03 21:24 | Error downloading source code: list files timed out after 1m0s |
| `01f1d7ac…646d0` | 2026-11-03 17:35 | Error downloading source code: list files timed out after 1m0s |

The app's compute is running, but its active deployment is the failed one.

Likely causes (not confirmed: the build logs at `<app-url>/logz` need a browser session and aren't available through the API):

* **Databricks-managed Python constraints.** The latest message says the Apps runtime applies its own version constraints to installs. Several exact pins in `pyproject.toml` are packages the runtime may constrain, for example `databricks-sdk==0.148.0`, `databricks-sql-connector==4.5.0`, `mlflow==3.17.1`, `numpy==2.2.6`, `pandas==2.3.3`, `pyarrow==24.0.0`, `pydantic==2.13.5` and `fastapi==0.141.1`. An exact pin outside the allowed range fails the install.
* **No egress at install time.** The older copy installed from a normal `requirements.txt` or `pyproject.toml`, which needs PyPI. The new artifact design (`--no-index --find-links ./wheels`) avoids that, so the earlier "Error installing packages" failures may not recur. The constraints conflict still could.

The new copy installs the same pinned versions, so expect the same constraints failure until it's ruled out.

**Next steps:**

1. Open `https://<ontos-alex-baretto app URL>/logz` in a browser and read the installer error for deployment `01f1df69…`.
2. If it's a constraints conflict, relax the conflicting pins in `pyproject.toml` (or disable managed constraints, if the workspace allows it), re-lock (#2) and rebuild (#1).
3. Run `scripts/check_artifact.sh` before deploying. It checks that the wheels install offline, but **not** against Databricks-managed constraints.

The two source-download timeouts (Nov 3) came from stale `frontend/node_modules`, `e2e` and `tests` folders left in `.bundle/ontos/dev/files` by a deploy made before the exclude rules were added. They don't apply to `dev-abacus`, which uses a new bundle folder and deploys only `app_artifact/`.

### 7. In-app admins default to the `admins` group

**Verified (config).** `resources/app.yml` sets `APP_ADMIN_DEFAULT_GROUPS='["admins"]'`, and `backend/src/common/config.py` uses the same default. You aren't in `admins` (your groups are `users` and `demo-build-implementation`), so after deploy only workspace admins get the app's admin role. You could open the app but not configure roles, settings or permissions in it.

**Fix:** the value is a fixed string in `resources/app.yml`, not a bundle variable, so changing it for `dev-abacus` only means first turning it into a variable (for example `app_admin_groups`, defaulting to `'["admins"]'`) and overriding it in `dev-abacus` with `'["admins", "demo-build-implementation"]'`. Otherwise, have a workspace admin grant the role after the first start. Not changed yet.

---

## Risks to check on the first deploy

### 8. The migrate job's environment may not install packages without egress

**Risk.** `resources/migrate.yml` runs `jobs/migrate.py` (Alembic upgrade) on serverless with 10 pinned `dependencies` (alembic, databricks-sdk, databricks-sql-connector, fastapi, psycopg2-binary, pydantic, pydantic-settings, python-dotenv, pyyaml, sqlalchemy). The comment says serverless environments resolve these "where the runtime has no package-index egress". This workspace's serverless can't resolve PyPI from notebooks (#3), and I haven't checked whether environment builds go through a separate path that can.

**Check:** after deploy, run the `ontos-migrate-abacus-alex-baretto` job. If the environment fails to install, the app starts with an empty schema. Fall back to a private package mirror, or to wheels in a volume (`genie_agents.internal.libraries` exists and could hold them).

### 9. Permission to create a Lakebase project and SQL warehouse is unconfirmed

**Risk.** `dev-abacus` creates new resources, all named `ontos-abacus-alex-baretto`:

* A Lakebase project (pg 17, 7-day history, `purge_on_delete: true`), with a `production` branch, an `app_owner` role, an `app` database and a read/write endpoint at 0.5 CU
* A serverless PRO 2X-Small SQL warehouse, displayed as `[dev alex_baretto] ontos-abacus-alex-baretto`
* A job, displayed as `[dev alex_baretto] ontos-migrate-abacus-alex-baretto`
* A Unity Catalog schema, with an `app_files` volume

`bundle validate` doesn't check the permissions needed to create these. You'll need permission to create Lakebase projects and SQL warehouses, plus create-schema rights on `genie_agents` (you have ALL PRIVILEGES). An earlier deploy of the `ontos` bundle created `ontos-alex-baretto`, which suggests Apps and Lakebase creation worked then.

---

## Other issues

### 10. The `prd` target can't be validated by this user

**Verified.** `bundle validate -t prd` fails with `403 PERMISSION_DENIED` when creating `/Workspace/bundles/ontos/prd/files`, because you can't view the folder at the top of the workspace. `prd` is meant to be deployed by Seiji with a CI-published artifact, so this doesn't affect a dev deploy, but none of this session's changes have been validated against `prd`.

### 11. The UC schema name isn't suffixed

**Verified (config).** `resources/unity_catalog.yml` names the schema `app_ontos`, with no `${var.name_suffix}`. Development mode adds the user prefix, so both `dev` and `dev-abacus` resolve to `genie_agents.dev_alex_baretto_app_ontos`. That schema doesn't exist yet, so there's no clash today. If the original `ontos` bundle is ever deployed to `genie_agents` with `-t dev`, both copies would claim the same schema and volume, and the second deploy fails or takes over the first.

**Fix (optional):** suffix the schema name, or override `catalog` per copy.

### 12. Indirect PyPI dependencies are unknown

**Verified.** `/Volumes/genie_agents/internal/libraries/abacus-ontos-dependencies.csv` (1,011 rows) lists 49 PyPI rows from `pyproject.toml` (38 runtime, 7 dev, 3 e2e, 1 build) and all 962 npm package versions from `frontend/pnpm-lock.yaml` (97 direct, 865 indirect). The packages the PyPI dependencies pull in can't be listed until `uv.lock` exists (#2). That blocks a full license or security review of the backend, and makes it harder to diagnose #6.

### 13. Harmless validate warnings

**Verified.** After F4, `bundle validate` for `dev` and `dev-abacus` reports three warnings: sync patterns that match nothing (`**/.terraform/**`, `*.auto.tfvars.json`, `cli/**`). They don't affect the deploy.

---

## Fixed in this session

All fixes are on `feat/hello-abacus` (pushed to `alexxx-db/ontos`). No PR has been opened yet: [compare main...feat/hello-abacus](https://github.com/alexxx-db/ontos/compare/main...feat/hello-abacus?expand=1).

### F1. `app_source_code_path` pointed at `resources/app_artifact`

The variable default `./app_artifact` is resolved relative to `resources/app.yml`, where it's used, so `bundle validate` failed with `stat resources/app_artifact: no such file or directory`. Changed to `../app_artifact` (commit "fix(bundle): resolve app_artifact path and add dev-abacus target"). Validated: the app's source path now resolves to `src/app_artifact`.

### F2. A `dev` deploy would take over `ontos-alex-baretto`

`dev` uses the bundle folder `.bundle/ontos/dev` and the name suffix `-alex-baretto`, the same as the existing app. A deploy would have taken over its state and replaced it. Added a `dev-abacus` target (same commit) with its own folder (`.bundle/ontos/dev-abacus`) and suffix (`-abacus-alex-baretto`). The app, Lakebase project, warehouse and job names are now separate. `dev` and `prd` are unchanged.

### F3. The `demo-build-ontos-viewer` group doesn't exist

`app_viewers_group` defaults to `${customer}-${workspace}-ontos-viewer`. The workspace has `demo-build-implementation`, `demo-build-admin`, `demo-admin` and other demo groups, but no `ontos-viewer` group. In `dev-abacus`, `app_viewers_group` is set to `${var.implementers_group}` (`demo-build-implementation`) (same commit). Duplicate grants are merged, as checked with `bundle validate`. For a real customer deploy, the viewer group still has to be created in ng-infrastructure.

### F4. The app service principal was missing from the warehouse permissions

`bundle validate` warned that the warehouse's own permissions list would overwrite the CAN_USE the app resource grants its service principal. Added `service_principal_name: ${resources.apps.ontos.service_principal_client_id}` with `CAN_USE` to `resources/warehouse.yml` (commit "fix(bundle): grant the app service principal CAN_USE on its warehouse"). The warning is gone for `dev` and `dev-abacus`.

---

## Deploy checklist (`dev-v2`, from the workspace)

From `src/`, with `src/app_artifact/` built by `scripts/build_artifact_offline.py` (see Progress):

1. An admin resolves W (see `admin_request_sql_warehouse.md`). If they create the warehouse for you, run `databricks bundle deployment bind warehouse <id> -t dev-v2`.
2. Run the three `GRANT USE CATALOG ON CATALOG genie_agents` statements in #5.
3. `databricks bundle deploy -t dev-v2`
4. `databricks bundle run -t dev-v2 migrate`. This is already done; re-run only if the migrations changed.
5. `databricks bundle run -t dev-v2 ontos`. Check that the deployment is `SUCCEEDED`, that the app logs show `bootstrap.sh` finished its install, and that the app opens for a `demo-build-implementation` member. (#6, N3)
6. Give the app's service principal access to the `app_ontos` tables, or transfer their ownership to it. (N1)

## Original checklist (2026-11-16, `dev-abacus`, laptop or CI)

On a laptop or in CI with PyPI and npm access, from `src/`:

1. `git pull` on `feat/hello-abacus`.
2. `uv lock`, then commit `uv.lock`. (#2)
3. `pnpm --dir frontend install --frozen-lockfile && pnpm --dir frontend run build && bash scripts/build_artifact.sh`, then `bash scripts/check_artifact.sh`. (#1, #3, #4)
4. Read `/logz` for the failed `ontos-alex-baretto` deployment and adjust pins if needed, then repeat steps 2 and 3. (#6)
5. In Databricks SQL, run the `GRANT USE CATALOG` statements in #5.
6. Optionally make `APP_ADMIN_DEFAULT_GROUPS` a variable and override it for `dev-abacus`. (#7)
7. `databricks bundle deploy -t dev-abacus --var customer=demo --var workspace=build --var catalog=genie_agents`
8. `databricks bundle run -t dev-abacus migrate` (same `--var` flags) and check that the environment installs. (#8)
9. `databricks bundle run -t dev-abacus ontos` and check that the deployment status is `SUCCEEDED` and the app opens for a `demo-build-implementation` member.
