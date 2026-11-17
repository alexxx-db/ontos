# Request: SQL warehouse access for the Ontos app (demo-build workspace)

**To:** demo-build workspace admin
**From:** alex.baretto@abacusinsights.com
**Workspace:** dbc-fb7dab4f-d795.cloud.databricks.com

## What I need

I'm deploying the Ontos data-governance app (bundle `ontos`, target `dev-v2`). The deploy stops at its SQL warehouse:

```
Error: cannot create resources.sql_warehouses.warehouse:
alex.baretto@abacusinsights.com is not authorized to create SQL Endpoint. (403 PERMISSION_DENIED)
```

The app can't be created until it has a warehouse, because it binds one as an app resource. Its Lakebase database, schema, volume and migration job are already deployed, and the migrations have succeeded. To bind a warehouse, the deployer needs **CAN MANAGE** on it. I have no Manage on any warehouse in this workspace (`demo-genesis-warehouse`, `Serverless Starter Warehouse`, `replit-warehouse`).

## Please do one of the following

### Option A (preferred): create the warehouse and give me CAN MANAGE

This needs no bundle change and no new entitlement, and it scopes my access to this one warehouse.

1. Create a SQL warehouse with exactly these settings (they match `src/resources/warehouse.yml`):

   | Setting | Value |
   | --- | --- |
   | Name | `ontos-v2-alex-baretto` |
   | Type | Serverless (PRO) |
   | Cluster size | 2X-Small |
   | Scaling | min 1, max 1 cluster |
   | Auto stop | 10 minutes |

2. Grant **CAN MANAGE** on it to `alex.baretto@abacusinsights.com`.
3. Send me the warehouse ID. I'll run `databricks bundle deployment bind warehouse <id> -t dev-v2` to bind it to the bundle, then deploy. The deploy sets these CAN USE grants itself:
   * `demo-build-implementation`
   * `demo-build-admin`
   * `demo-admin`
   * the app's service principal, which the deploy creates

### Option B: let me create SQL warehouses

Give `alex.baretto@abacusinsights.com` (or `demo-build-implementation`) the workspace entitlement that allows creating SQL warehouses (Admin settings > Identity and access). The bundle then creates the warehouse above on the next deploy.

### Option C: give me CAN MANAGE on an existing warehouse

For example, `demo-genesis-warehouse` (`337986b7fa599984`). I would point `dev-v2` at it instead of creating a new one. The drawback: the app's deploys would then manage that warehouse's permission list and could reset grants other teams rely on. That's why A is preferred.

## Cost

The warehouse is one serverless 2X-Small cluster that stops after 10 idle minutes. It runs only when an Ontos user queries a dataset (users query as themselves).

## No admin action needed for these

* **Catalog grants:** USE CATALOG on `genie_agents` for `demo-build-implementation`, `demo-build-admin` and `demo-admin`. I hold MANAGE on the catalog and will run these myself.
* **App admin group (resolved):** `dev-v2` now sets `app_admin_groups` to `["admins", "demo-build-implementation"]`, so the implementation group gets the app's admin role on first start. Nobody needs to be added to `admins`. This is pushed to `feat/hello-abacus`.
