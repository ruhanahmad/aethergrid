# AetherGrid Demo

Open **Demo** in the authenticated dashboard. The former `/recovery-lab` URL redirects to `/demo`.

## Run locally

Use the local Postgres setup from the [repository README](../README.md). Apply migration 0006 to the local database before starting the API. In PowerShell at the repository root, with Postgres running on the README's local port:

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -e ".[dev]"
$env:NEUROMESH_STORAGE_BACKEND = "postgres"
$env:NEUROMESH_DATABASE_URL = "postgresql://neuromesh@127.0.0.1:5433/neuromesh"
$env:NEUROMESH_DATABASE_PASSWORD_FILE = "./secrets/postgres_password.local"
./.venv/Scripts/python.exe -m app.infrastructure.migrations
./.venv/Scripts/python.exe -m uvicorn app.presentation.api:app --host 127.0.0.1 --port 18183
```

In a second PowerShell window:

```powershell
Set-Location frontend
npm ci
$env:VITE_API_URL = "http://127.0.0.1:18183"
npm run dev -- --host localhost --port 5174 --strictPort
```

Open `http://localhost:5174/demo` and sign in with an existing key from the local database. Demo endpoints accept unscoped keys. The customer sign-in inside Demo is illustrative and uses a fixed account label.

## Present a recovery

1. Select **Start Demo** to provision or resume a run, and enter the customer dashboard. **New run** starts a second run without touching the selected run.
2. Select **Submit Business Task**. Expand **API request and response** to show the actual POST and HTTP response. The commandless report aggregates 800 synthetic orders in batches.
3. Wait for Worker A to show an active lease. Use **Inspect Lease** to see the expiry and optionally test stale renewal. The regular lease service should return HTTP 409 and leave the active lease unchanged.
4. Select **Disrupt Worker A** while it is running. The backend stops that report attempt and stops Worker A and Node A heartbeats and lease renewals. The scheduler excludes Node A from further assignments while interrupted. The existing reconciliation service handles expiry, consumes a retry, and makes the same report available to Worker B. Watch the actual events in **Observe Recovery**.
5. Node and worker timeout can take about a minute from the last heartbeat. After both are offline and the lease is gone, **Restore Worker** sends fresh heartbeats. Recovery and completion can precede the liveness timeouts.
6. **Presentation Mode** enlarges the execution path and hides the run picker and archive controls. **Restart Demo** retires the selected run and prepares a new one. Archived runs retain evidence and stop renewing heartbeats. A running cancellation can settle when its lease expires.

## Ownership and operational limits

Each server-owned run uses a resource namespace enforced by AetherGrid's normal tenant-aware scheduler and repositories. The caller's tenant owns the run record and continues to use its existing API key. Ordinary resources and other runs cannot be targeted through the demo API. Run state survives frontend and Postgres-backed API restarts. Memory and SQLite development configurations keep the demo metadata, workers and API keys in process memory. After closing a tab, sign in again with the same key to list and reopen the stored runs. Legacy browser-tracked lab resources have no server-owned run record and are left as ordinary tenant resources.

Each tenant can keep up to three active runs. Each run accepts one report. The agent interrupts a real cooperative report task within the backend process. It leaves the shared process and other workloads running. A new scheduler leader lets any previous report lease expire so reconciliation can retry it. The job may execute again on another worker, and the report only aggregates synthetic data.

## Run tests

From the repository root with the editable development environment installed:

```powershell
$env:NEUROMESH_STORAGE_BACKEND = "memory"
./.venv/Scripts/python.exe -m pytest tests/presentation/test_demo_api.py tests/presentation/test_route_tenancy_registry.py tests/application/test_scheduler_loop_service.py tests/application/reconciliation
```

The live recovery test takes about a minute. To verify persistent storage, use a separate local Postgres database whose name ends in `_test`, set both database URLs, and run the migrations before pytest:

```powershell
$env:NEUROMESH_STORAGE_BACKEND = "postgres"
$env:NEUROMESH_TEST_DATABASE_URL = "postgresql://neuromesh@127.0.0.1:5433/neuromesh_test"
$env:NEUROMESH_DATABASE_URL = $env:NEUROMESH_TEST_DATABASE_URL
./.venv/Scripts/python.exe -m app.infrastructure.migrations
./.venv/Scripts/python.exe -m pytest tests/presentation/test_demo_api.py tests/presentation/test_route_tenancy_registry.py
```

From `frontend/`:

```powershell
npm ci
npm run lint
npm run test
npm run build
```
