from __future__ import annotations

from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.domain.entities.tenant import Tenant
from app.infrastructure.repositories.postgres_demo_store import PostgresDemoStore
from app.presentation.api import app
from app.presentation.auth import require_api_key
from app.presentation.dependencies import (
    _api_key_repository,
    _tenant_repository,
    get_cluster_tick_service,
    get_connection_pool,
    get_reconciliation_loop,
)
from tests.support.api_keys import make_api_key

SESSIONS = "/demo/sessions"


@pytest.fixture
def demo_clients() -> Iterator[tuple[TestClient, TestClient, Tenant, str]]:
    # These routes exercise the actual bearer-key authentication, including a key
    # with no command-execution or key-management scope.
    app.dependency_overrides.pop(require_api_key, None)
    tenants = [Tenant.create(f"test-demo-{monotonic()}-{index}") for index in range(2)]
    clients = []
    raw_keys = []
    for tenant in tenants:
        _tenant_repository.save(tenant)
        key, raw = make_api_key("demo-route-test", tenant_id=tenant.id)
        _api_key_repository.save(key)
        clients.append(TestClient(app, headers={"Authorization": f"Bearer {raw}"}))
        raw_keys.append(raw)
    try:
        yield clients[0], clients[1], tenants[0], raw_keys[0]
    finally:
        for client in clients:
            response = client.get(SESSIONS)
            if response.is_success:
                for run in response.json():
                    if not run["archived_at"]:
                        client.post(f"{SESSIONS}/{run['id']}/archive")
            client.close()


def test_owned_runs_resume_without_touching_other_resources(
    demo_clients: tuple[TestClient, TestClient, Tenant, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    owner, outsider, tenant, raw = demo_clients
    normal_node = owner.post("/nodes", json={"cpu_cores": 8, "memory_mib": 8192, "vram_mib": 0})
    assert normal_node.is_success
    ordinary = owner.post("/jobs", json={"cpu_cores": 999, "memory_mib": 128, "vram_mib": 0})
    assert ordinary.is_success
    before_nodes = owner.get("/nodes").json()
    before_jobs = owner.get("/jobs").json()

    anonymous = TestClient(app)
    try:
        assert anonymous.get(SESSIONS).status_code == 401
        assert anonymous.post(SESSIONS).status_code == 401
    finally:
        anonymous.close()
    created = owner.post(SESSIONS)
    assert created.status_code == 201
    assert raw not in created.text
    run_id = created.json()["id"]
    path = f"{SESSIONS}/{run_id}"
    snapshot = owner.get(path).json()
    assert all(a["node_id"] and a["worker_id"] for a in snapshot["agents"])
    assert {a["slot"] for a in snapshot["agents"]} == {"A", "B"}
    assert outsider.get(SESSIONS).json() == []
    assert outsider.get(path).status_code == 404
    for action in ("report", "interrupt", "restore", "restart", "archive", "stale-a", "stale-b"):
        assert outsider.post(f"{path}/{action}").status_code == 404

    # A second tab can race the first. Exactly one POST provisions the report.
    with ThreadPoolExecutor(max_workers=2) as tabs:
        requests = [tabs.submit(owner.post, f"{path}/report") for _ in range(2)]
        responses = [request.result() for request in requests]
    assert sorted(response.status_code for response in responses) == [201, 409]
    report = next(response for response in responses if response.status_code == 201)
    assert report.status_code == 201
    assert report.json()["status"] == "QUEUED"
    assert report.json()["max_retries"] == 2
    assert owner.post(f"{path}/report").status_code == 409
    assert owner.get(f"/jobs/{report.json()['id']}").status_code == 404
    assert owner.get(f"/nodes/{snapshot['agents'][0]['node_id']}").status_code == 404

    reopened = TestClient(app, headers=owner.headers)
    try:
        assert [run["id"] for run in reopened.get(SESSIONS).json()] == [run_id]
        assert reopened.get(path).json()["job"]["id"] == report.json()["id"]
    finally:
        reopened.close()

    pool = get_connection_pool()
    if pool is not None:
        # A fresh storage object discovers the run directly from Postgres.
        restored = PostgresDemoStore(pool).list_for(tenant.id)
        assert [str(run.namespace) for run in restored] == [run_id]

    parallel = owner.post(SESSIONS).json()
    parallel_path = f"{SESSIONS}/{parallel['id']}"
    parallel_agents = owner.get(parallel_path).json()["agents"]
    assert parallel["id"] != run_id
    assert {a["worker_id"] for a in parallel_agents}.isdisjoint(
        a["worker_id"] for a in snapshot["agents"]
    )
    fresh = owner.post(f"{path}/restart")
    assert fresh.status_code == 200
    assert fresh.json()["id"] not in (run_id, parallel["id"])
    archived = owner.get(path).json()
    assert archived["session"]["archived_at"]
    assert archived["job"]["status"] == "CANCELLED"
    assert owner.get(parallel_path).json()["agents"] == parallel_agents
    assert owner.get("/nodes").json() == before_nodes
    assert owner.get("/jobs").json() == before_jobs
    assert raw not in caplog.text


def _until(
    client: TestClient,
    path: str,
    condition: Callable[[dict[str, Any]], bool],
    timeout: float,
) -> dict[str, Any]:
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        get_cluster_tick_service().execute()
        get_reconciliation_loop().execute()
        response = client.get(path)
        assert response.is_success, response.text
        snapshot = response.json()
        if condition(snapshot):
            return snapshot
        sleep(0.4)
    pytest.fail(f"Backend did not reach expected state: {snapshot}")


@pytest.mark.slow
def test_live_interrupt_reclaims_lease_and_worker_b_completes(
    demo_clients: tuple[TestClient, TestClient, Tenant, str],
) -> None:
    client, _, _, _ = demo_clients
    run = client.post(SESSIONS).json()
    path = f"{SESSIONS}/{run['id']}"
    report = client.post(f"{path}/report")
    assert report.status_code == 201

    running = _until(client, path, lambda s: s["job"]["status"] == "RUNNING", 12)
    initial = running["agents"][0]["lease"]
    assert initial["current"]
    rejected = client.post(f"{path}/stale-a")
    assert rejected.status_code == 409
    assert rejected.json()["detail"] == "The lease service rejected the stale lease identity."
    assert client.get(path).json()["agents"][0]["lease"] == initial
    renewed = _until(
        client, path, lambda s: any(e["type"] == "DemoLeaseRenewed" for e in s["events"]), 18
    )
    assert renewed["agents"][0]["lease"]["expires_at"] > initial["expires_at"]
    assert client.post(f"{path}/interrupt").status_code == 200
    assert client.post(f"{path}/restore").status_code == 409

    final = _until(
        client,
        path,
        lambda s: (
            s["job"]["status"] == "COMPLETED"
            and s["agents"][0]["node_online"] is False
            and {"DemoWorkerOffline", "DemoNodeOffline"} <= {e["type"] for e in s["events"]}
        ),
        78,
    )
    assert final["job"]["retry_count"] == 1
    assert final["agents"][0]["lease"] is None
    assert final["agents"][0]["worker_status"] == "OFFLINE"
    events = final["events"]
    assert "JobReclaimed" in [event["type"] for event in events]
    started = [e for e in events if e["type"] == "DemoReportStarted"]
    assert [e["details"]["slot"] for e in started] == ["A", "B"]
    assert started[0]["details"]["lease_id"] != started[1]["details"]["lease_id"]
    result = next(e for e in events if e["type"] == "DemoReportGenerated")
    assert result["details"]["orders"] == "800"
    assert int(result["details"]["total_cents"]) > 0
    assert client.post(f"{path}/restore").status_code == 200
    restored = client.get(path).json()
    assert restored["agents"][0]["node_online"] is True
    assert restored["agents"][0]["worker_status"] == "IDLE"
