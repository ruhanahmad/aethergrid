from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.application.services.demo_controller import (
    DemoConflictError,
    DemoController,
    DemoNotFoundError,
)
from app.application.services.demo_store import DemoSession
from app.domain.entities.api_key import ApiKey
from app.domain.entities.job import Job
from app.domain.exceptions.lease_not_found_error import LeaseNotFoundError
from app.domain.exceptions.no_active_lease_error import NoActiveLeaseError
from app.domain.value_objects.tenant_id import TenantId
from app.presentation.auth import require_api_key, require_rate_limit
from app.presentation.dependencies import get_demo_controller

router = APIRouter(
    prefix="/demo/sessions",
    tags=["Demo"],
    dependencies=[Depends(require_api_key), Depends(require_rate_limit)],
)

Caller = Annotated[ApiKey, Depends(require_api_key)]
Controller = Annotated[DemoController, Depends(get_demo_controller)]


class SessionResponse(BaseModel):
    id: UUID
    created_at: datetime
    interrupted_at: datetime | None
    archived_at: datetime | None


class JobResponse(BaseModel):
    id: str
    status: str
    assigned_node_id: str | None
    retry_count: int
    max_retries: int
    cpu_cores: int
    memory_mib: int
    exit_code: int | None


class LeaseResponse(BaseModel):
    id: UUID
    job_id: str
    acquired_at: datetime
    expires_at: datetime
    current: bool


class AgentResponse(BaseModel):
    slot: str
    node_id: str | None
    node_online: bool | None
    node_last_seen_at: datetime | None
    worker_id: str | None
    worker_status: str | None
    worker_last_seen_at: datetime | None
    worker_job_id: str | None
    cpu_cores: int | None
    memory_mib: int | None
    lease: LeaseResponse | None


class EventResponse(BaseModel):
    id: str
    resource_id: str
    type: str
    occurred_at: datetime
    details: dict[str, str]


class SnapshotResponse(BaseModel):
    session: SessionResponse
    agents: list[AgentResponse]
    job: JobResponse | None
    events: list[EventResponse]


def _session(session: DemoSession) -> SessionResponse:
    return SessionResponse(
        id=session.namespace.value,
        created_at=session.created_at,
        interrupted_at=session.interrupted_at,
        archived_at=session.archived_at,
    )


def _job(job: Job) -> JobResponse:
    return JobResponse(
        id=str(job.id),
        status=job.status.name,
        assigned_node_id=str(job.assigned_node_id) if job.assigned_node_id else None,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        exit_code=job.exit_code,
        cpu_cores=job.resources.cpu_cores,
        memory_mib=job.resources.memory_mib,
    )


@contextmanager
def _translate_errors() -> Iterator[None]:
    try:
        yield
    except DemoNotFoundError as exc:
        raise HTTPException(404, "Demo session not found.") from exc
    except DemoConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (LeaseNotFoundError, NoActiveLeaseError) as exc:
        raise HTTPException(409, "The lease service rejected the stale lease identity.") from exc


@router.get("")
def list_sessions(caller: Caller, controller: Controller) -> list[SessionResponse]:
    return [_session(session) for session in controller.list_sessions(caller.tenant_id)]


@router.post("", status_code=201)
def start_session(caller: Caller, controller: Controller) -> SessionResponse:
    with _translate_errors():
        return _session(controller.start(caller.tenant_id))


@router.get("/{session_id}")
def inspect_session(session_id: UUID, caller: Caller, controller: Controller) -> SnapshotResponse:
    with _translate_errors():
        snapshot = controller.snapshot(caller.tenant_id, TenantId(session_id))
    agents = []
    for state in snapshot.agents:
        node, worker, lease = state.node, state.worker, state.lease
        agents.append(
            AgentResponse(
                slot=state.slot,
                node_id=str(node.id) if node else None,
                node_online=node.is_alive() if node else None,
                node_last_seen_at=node.last_seen_at if node else None,
                worker_id=str(worker.id) if worker else None,
                worker_status=worker.status.name if worker else None,
                worker_last_seen_at=worker.last_seen_at if worker else None,
                worker_job_id=str(worker.running_job.id) if worker and worker.running_job else None,
                cpu_cores=node.capacity.cpu_cores if node else None,
                memory_mib=node.capacity.memory_mib if node else None,
                lease=LeaseResponse(
                    id=lease.id,
                    job_id=str(lease.job_id),
                    acquired_at=lease.acquired_at,
                    expires_at=lease.expires_at,
                    current=not lease.is_expired(),
                )
                if lease
                else None,
            )
        )
    return SnapshotResponse(
        session=_session(snapshot.session),
        agents=agents,
        job=_job(snapshot.job) if snapshot.job else None,
        events=[
            EventResponse(
                id=str(event.id),
                resource_id=event.aggregate_id,
                type=event.event_type,
                occurred_at=event.occurred_at,
                details=event.payload,
            )
            for event in snapshot.events
        ],
    )


@router.post("/{session_id}/report", status_code=201)
def submit_report(session_id: UUID, caller: Caller, controller: Controller) -> JobResponse:
    with _translate_errors():
        return _job(controller.submit(caller.tenant_id, TenantId(session_id)))


@router.post("/{session_id}/{action}")
def change_session(
    session_id: UUID,
    action: Literal["interrupt", "restore", "restart", "archive", "stale-a", "stale-b"],
    caller: Caller,
    controller: Controller,
) -> SessionResponse:
    owner, namespace = caller.tenant_id, TenantId(session_id)
    with _translate_errors():
        if action == "interrupt":
            return _session(controller.interrupt(owner, namespace))
        if action == "restore":
            return _session(controller.restore(owner, namespace))
        if action == "restart":
            return _session(controller.restart(owner, namespace))
        if action == "archive":
            return _session(controller.archive(owner, namespace))
        controller.reject_stale(owner, namespace, "A" if action == "stale-a" else "B")
        raise RuntimeError("Stale lease check must reject the renewal")
