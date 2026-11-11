# Recovery Lab

Run the local backend and database using the [repository setup](../README.md). Create a dedicated, empty tenant for the demo.

```sh
python scripts/issue_api_key.py recovery-lab --tenant recovery-lab --create-tenant --scope jobs:execute
```

The success, failure, and slow presets execute fixed Python commands on the backend, so the runtime needs `python` on its PATH. Run the command executor on Linux, for example in the repository Docker setup or WSL, because it uses POSIX subprocess features. In `frontend/.env.local`, set `VITE_RECOVERY_LAB_ENABLED=true` and, if needed, set `VITE_API_URL` to the demo backend. Run `npm ci` and `npm run dev` from `frontend/`. Sign in with the demo key and open **Recovery Lab** in the sidebar.

1. Register both test nodes and a worker on each. The reported capacities are declarations for the scheduler.
2. Run the success, failure and oversized presets and inspect the selected job's status and timeline. Retry asks the backend to requeue a failed job if its retry budget permits. Oversized jobs request one CPU core more than the largest currently listed node and can be cancelled while waiting for capacity.
3. Run the slow job and select its assigned worker in the lease inspector. Use **Test Stale Lease** while a current lease is visible. An HTTP 409 shows that the backend rejected the renewal. The test submits a different UUID and uses the normal renewal endpoint.
4. Pause a test node or worker's heartbeats. Watch the server-reported status after the liveness timeout (about a minute, plus polling). Resume sends an immediate heartbeat. Active leases are renewed independently by the execution loop, so a heartbeat pause can show an offline resource while the job retains ownership and finishes. The timeline displays reclamation if the backend emits it.
5. **Reset demonstration** pauses the recorded resources and cancels active lab jobs. Once the jobs settle and nodes and workers are offline, use Reset again to remove the offline test nodes. Recent job history remains available. The backend may retain offline worker records.

Use the same browser tab for the demo and cleanup. Resource IDs are tracked in that tab's session storage. Heartbeat pauses are shared by dashboard tabs on the same frontend origin. The dashboard's job list shows the most recent 50 jobs. The lab checks the listed resources before provisioning or requeueing, and the dedicated tenant provides the actual scheduling isolation. Keep unrelated jobs and agents out of that tenant.

A real process-crash and lease-expiry exercise requires a separate isolated run with the repository's standalone test agent (`scripts/run_agent.py`). The in-dashboard heartbeat controls leave the backend execution process and its lease-renewal loop running.
