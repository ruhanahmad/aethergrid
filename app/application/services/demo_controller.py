from __future__ import annotations

import logging
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from threading import Event as StopSignal
from uuid import UUID, uuid4, uuid5

from app.application.services.cancel_job_service import CancelJobService
from app.application.services.create_job_service import CreateJobService
from app.application.services.create_worker_service import CreateWorkerService
from app.application.services.demo_store import DemoSession, DemoStore
from app.application.services.drain_node_service import DrainNodeService
from app.application.services.heartbeat_node_service import HeartbeatNodeService
from app.application.services.record_job_events_service import RecordJobEventsService
from app.application.services.renew_lease_service import RenewLeaseService
from app.application.services.report_job_outcome_service import ReportJobOutcomeService
from app.application.services.start_job_service import StartJobService
from app.application.services.worker_heartbeat_service import WorkerHeartbeatService
from app.domain.entities.event import Event
from app.domain.entities.job import Job
from app.domain.entities.lease import Lease
from app.domain.entities.node import Node
from app.domain.entities.worker import Worker
from app.domain.enums.job_status import JobStatus
from app.domain.enums.worker_management import WorkerManagement
from app.domain.enums.worker_status import WorkerStatus
from app.domain.exceptions.lease_not_found_error import LeaseNotFoundError
from app.domain.exceptions.no_active_lease_error import NoActiveLeaseError
from app.domain.repositories.event_repository import EventRepository
from app.domain.repositories.job_repository import JobRepository
from app.domain.repositories.lease_repository import LeaseRepository
from app.domain.repositories.node_repository import NodeRepository
from app.domain.repositories.worker_repository import WorkerRepository
from app.domain.value_objects.node_id import NodeId
from app.domain.value_objects.resource_requirements import ResourceRequirements
from app.domain.value_objects.tenant_id import TenantId
from app.domain.value_objects.worker_id import WorkerId

logger = logging.getLogger(__name__)
_SLOTS = ("A", "B")
_MAX_ACTIVE = 3
_MAX_ATTEMPTS = 12
_HEARTBEAT_INTERVAL = timedelta(seconds=10)
_RENEW_WITHIN = timedelta(seconds=20)
_FINISHED = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


class DemoNotFoundError(Exception):
    pass


class DemoConflictError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class DemoAgentState:
    slot: str
    node: Node | None
    worker: Worker | None
    lease: Lease | None


@dataclass(frozen=True, slots=True)
class DemoSnapshot:
    session: DemoSession
    agents: list[DemoAgentState]
    job: Job | None
    events: list[Event]


@dataclass(slots=True)
class _Attempt:
    namespace: TenantId
    lease_id: UUID
    stop: StopSignal
    work: Future[int | None]


def _report(slot: str, stop: StopSignal) -> int | None:
    """Aggregate 32 synthetic order batches, pacing collection for the demo."""
    total_cents = 0
    for batch in range(32):
        if stop.wait(0.75 if slot == "A" else 0.25):
            return None
        total_cents += sum(1200 + (batch * 71 + order * 131) % 9400 for order in range(25))
    return total_cents


def _node_id(session: DemoSession, slot: str) -> NodeId:
    return NodeId(uuid5(session.namespace.value, f"demo-node-{slot}"))


class DemoController:
    """Authorize by owning tenant, then operate solely in the run's namespace."""

    def __init__(
        self,
        store: DemoStore,
        nodes: NodeRepository,
        workers: WorkerRepository,
        jobs: JobRepository,
        leases: LeaseRepository,
        events: EventRepository,
        outcomes: ReportJobOutcomeService,
    ) -> None:
        self.store = store
        self._nodes = nodes
        self._workers = workers
        self._jobs = jobs
        self._leases = leases
        self._events = events
        self._record = RecordJobEventsService(events)
        self._outcomes = outcomes
        self._create_worker = CreateWorkerService(workers, jobs, leases, nodes)
        self._create_job = CreateJobService(jobs, self._record)
        self._cancel_job = CancelJobService(jobs)
        self._drain_node = DrainNodeService(nodes)
        self._heartbeat_node = HeartbeatNodeService(nodes)
        self._heartbeat_worker = WorkerHeartbeatService(workers)
        self._start_job = StartJobService(workers, jobs)
        self._renew = RenewLeaseService(leases)
        self._executor = ThreadPoolExecutor(
            max_workers=_MAX_ATTEMPTS, thread_name_prefix="demo-report"
        )
        self._attempts: dict[WorkerId, _Attempt] = {}

    @contextmanager
    def _mutation(self) -> Iterator[None]:
        with self.store.guard() as acquired:
            if not acquired:
                raise DemoConflictError("Demo is busy. Try again in a moment.")
            yield

    def _get(self, owner: TenantId, namespace: TenantId) -> DemoSession:
        session = self.store.get(owner, namespace)
        if session is None:
            raise DemoNotFoundError
        return session

    def _require_active(self, session: DemoSession) -> None:
        if session.archived_at is not None:
            raise DemoConflictError("This demo run is archived.")

    def _latest_job(self, session: DemoSession) -> Job | None:
        return next(iter(self._jobs.list_recent(1, session.namespace)), None)

    def _state(self, session: DemoSession, slot: str) -> DemoAgentState:
        node = self._nodes.get_by_id(_node_id(session, slot), session.namespace)
        worker = self._workers.get_by_node_id(node.id, session.namespace) if node else None
        lease = self._leases.get_by_worker_id(worker.id, session.namespace) if worker else None
        return DemoAgentState(slot, node, worker, lease)

    def list_sessions(self, owner: TenantId) -> list[DemoSession]:
        return self.store.list_for(owner)

    def snapshot(self, owner: TenantId, namespace: TenantId) -> DemoSnapshot:
        session = self._get(owner, namespace)
        job = self._latest_job(session)
        return DemoSnapshot(
            session,
            [self._state(session, slot) for slot in _SLOTS],
            job,
            self._events.list_by_aggregate(str(job.id), namespace) if job else [],
        )

    def _new(self, owner: TenantId) -> DemoSession:
        if sum(s.archived_at is None for s in self.store.list_for(owner)) >= _MAX_ACTIVE:
            raise DemoConflictError("Archive an existing run before opening another.")
        session = DemoSession(TenantId.new(), owner, datetime.now(UTC))
        self.store.create(session)
        for slot in _SLOTS:
            self._prepare(session, slot)
        return session

    def start(self, owner: TenantId) -> DemoSession:
        with self._mutation():
            return self._new(owner)

    def submit(self, owner: TenantId, namespace: TenantId) -> Job:
        with self._mutation():
            session = self._get(owner, namespace)
            self._require_active(session)
            if self._latest_job(session) is not None:
                raise DemoConflictError(
                    "This run already has a report. Start a fresh run for another."
                )
            for slot in _SLOTS:
                self._prepare(session, slot)
            # A fixed, commandless report. The bounded demo agent supplies its execution.
            return self._create_job.execute(
                ResourceRequirements(1, 128, 0), namespace, max_retries=2
            )

    def _prepare(self, session: DemoSession, slot: str) -> DemoAgentState:
        state = self._state(session, slot)
        node = state.node
        if node is None:
            scale = 1 if slot == "A" else 2
            node = Node.register(
                id=_node_id(session, slot),
                capacity=ResourceRequirements(2 * scale, 1024 * scale, 0),
                tenant_id=session.namespace,
                name=f"Demo Node {slot}",
            )
            self._nodes.save(node)
        worker = state.worker or self._create_worker.execute(
            node, managed_by=WorkerManagement.AGENT
        )
        return DemoAgentState(slot, node, worker, state.lease)

    def _stop_worker(self, worker_id: WorkerId) -> None:
        attempt = self._attempts.pop(worker_id, None)
        if attempt:
            attempt.stop.set()
            attempt.work.cancel()

    def interrupt(self, owner: TenantId, namespace: TenantId) -> DemoSession:
        with self._mutation():
            session = self._get(owner, namespace)
            self._require_active(session)
            state = self._state(session, "A")
            worker = state.worker
            job = worker.running_job if worker else None
            if session.interrupted_at is not None or not worker or not job or not state.lease:
                raise DemoConflictError("Wait for Worker A to start processing a report.")
            if job.status != JobStatus.RUNNING or state.lease.is_expired():
                raise DemoConflictError(
                    "Worker A no longer has a running report with a current lease."
                )
            session = replace(session, interrupted_at=datetime.now(UTC))
            self.store.save(session)
            self._stop_worker(worker.id)
            self._record.record_for_job(job, "DemoWorkerInterrupted", self._evidence(state))
            return session

    def restore(self, owner: TenantId, namespace: TenantId) -> DemoSession:
        with self._mutation():
            session = self._get(owner, namespace)
            self._require_active(session)
            state = self._state(session, "A")
            if (
                session.interrupted_at is None
                or state.lease is not None
                or state.node is None
                or state.node.is_alive()
                or state.worker is None
                or state.worker.status != WorkerStatus.OFFLINE
            ):
                raise DemoConflictError(
                    "Wait for Node A and Worker A to go offline and lose the lease."
                )
            session = replace(session, interrupted_at=None)
            self.store.save(session)
            self._pulse(session, self._prepare(session, "A"), force=True)
            job = self._latest_job(session)
            if job:
                self._record.record_for_job(job, "DemoWorkerRestored", self._evidence(state))
            return session

    def reject_stale(self, owner: TenantId, namespace: TenantId, slot: str) -> None:
        with self._mutation():
            session = self._get(owner, namespace)
            self._require_active(session)
            state = self._state(session, slot)
            if not state.worker or not state.lease or state.lease.is_expired():
                raise DemoConflictError("Select a demo worker with a current lease.")
            wrong_id = uuid4()
            while wrong_id == state.lease.id:
                wrong_id = uuid4()
            try:
                self._renew.execute(state.worker.id, wrong_id, namespace)
            except (LeaseNotFoundError, NoActiveLeaseError):
                job = state.worker.running_job
                if job:
                    self._record.record_for_job(
                        job, "DemoStaleLeaseRejected", self._evidence(state)
                    )
                raise
            raise RuntimeError("Lease service accepted an unrelated ID")

    def _archive(self, session: DemoSession) -> DemoSession:
        for slot in _SLOTS:
            state = self._state(session, slot)
            if state.node:
                self._drain_node.execute(state.node.id, session.namespace)
            if state.worker:
                self._stop_worker(state.worker.id)
        job = self._latest_job(session)
        if job and job.status not in _FINISHED:
            self._cancel_job.execute(job.id, session.namespace)
        archived = replace(session, archived_at=datetime.now(UTC))
        self.store.save(archived)
        return archived

    def restart(self, owner: TenantId, namespace: TenantId) -> DemoSession:
        with self._mutation():
            session = self._get(owner, namespace)
            self._require_active(session)
            self._archive(session)
            return self._new(owner)

    def archive(self, owner: TenantId, namespace: TenantId) -> DemoSession:
        with self._mutation():
            session = self._get(owner, namespace)
            self._require_active(session)
            return self._archive(session)

    def _pulse(self, session: DemoSession, state: DemoAgentState, *, force: bool = False) -> None:
        now = datetime.now(UTC)
        if state.node and (force or now - state.node.last_seen_at >= _HEARTBEAT_INTERVAL):
            self._heartbeat_node.execute(state.node.id, session.namespace)
        if state.worker and (force or now - state.worker.last_seen_at >= _HEARTBEAT_INTERVAL):
            self._heartbeat_worker.execute(state.worker.id, session.namespace)

    def _evidence(self, state: DemoAgentState) -> dict[str, str]:
        evidence = {"slot": state.slot}
        if state.node:
            evidence["node_id"] = str(state.node.id)
        if state.worker:
            evidence["worker_id"] = str(state.worker.id)
        if state.lease:
            evidence["lease_id"] = str(state.lease.id)
            evidence["expires_at"] = state.lease.expires_at.isoformat()
        return evidence

    def _observe_outage(self, session: DemoSession, state: DemoAgentState) -> None:
        offline = []
        if state.node and not state.node.is_alive():
            offline.append("DemoNodeOffline")
        if state.worker and state.worker.status == WorkerStatus.OFFLINE:
            offline.append("DemoWorkerOffline")
        job = self._latest_job(session) if offline else None
        if job is None or session.interrupted_at is None:
            return
        existing = {
            event.event_type
            for event in self._events.list_by_aggregate(str(job.id), session.namespace)
            if event.occurred_at >= session.interrupted_at
        }
        for event_type in offline:
            if event_type not in existing:
                self._record.record_for_job(job, event_type, self._evidence(state))

    def _advance_worker(self, session: DemoSession, state: DemoAgentState) -> None:
        worker, lease = state.worker, state.lease
        if worker is None:
            return
        job = worker.running_job
        attempt = self._attempts.get(worker.id)
        if job is None or lease is None or lease.is_expired() or lease.job_id != job.id:
            self._stop_worker(worker.id)
            return
        if attempt and attempt.lease_id != lease.id:
            self._stop_worker(worker.id)
            attempt = None

        if job.status == JobStatus.CANCELLING:
            self._stop_worker(worker.id)
            self._outcomes.cancel(worker.id, job.id, session.namespace, lease.id)
            return

        if job.status == JobStatus.SCHEDULED and len(self._attempts) < _MAX_ATTEMPTS:
            self._start_job.execute(worker.id, job.id, session.namespace)
            stop = StopSignal()
            self._attempts[worker.id] = _Attempt(
                session.namespace,
                lease.id,
                stop,
                self._executor.submit(_report, state.slot, stop),
            )
            self._record.record_for_job(job, "DemoReportStarted", self._evidence(state))
            return

        # When leadership changes, do not resume or renew the previous process's attempt.
        # The existing reconciliation service will recover it when the lease expires.
        if attempt is None:
            return
        if attempt.work.done():
            self._attempts.pop(worker.id, None)
            try:
                cents = attempt.work.result()
            except Exception:
                logger.exception("Demo report calculation failed")
                self._outcomes.fail(worker.id, job.id, session.namespace, lease.id, exit_code=1)
                return
            if cents is not None:
                self._outcomes.complete(worker.id, job.id, session.namespace, lease.id, exit_code=0)
                self._record.record_for_job(
                    job,
                    "DemoReportGenerated",
                    {
                        **self._evidence(state),
                        "orders": "800",
                        "total_cents": str(cents),
                    },
                )
            return
        if lease.expires_at - datetime.now(UTC) <= _RENEW_WITHIN:
            self._renew.execute(worker.id, lease.id, session.namespace)
            renewed = self._leases.get_by_worker_id(worker.id, session.namespace)
            if renewed and renewed.id == lease.id:
                self._record.record_for_job(
                    job,
                    "DemoLeaseRenewed",
                    self._evidence(replace(state, lease=renewed)),
                )

    def tick(self) -> set[NodeId]:
        """Advance local agents under scheduler leadership and return unavailable nodes."""
        with self.store.guard() as acquired:
            sessions = self.store.active()
            blocked = {_node_id(s, "A") for s in sessions if s.interrupted_at is not None}
            if not acquired:
                return blocked
            active = {session.namespace for session in sessions}
            for worker_id, attempt in list(self._attempts.items()):
                if attempt.namespace not in active:
                    self._stop_worker(worker_id)
            for session in sessions:
                try:
                    for slot in _SLOTS:
                        if slot == "A" and session.interrupted_at is not None:
                            state = self._state(session, slot)
                            if state.worker:
                                self._stop_worker(state.worker.id)
                            self._observe_outage(session, state)
                            continue
                        state = self._prepare(session, slot)
                        self._pulse(session, state)
                        self._advance_worker(session, state)
                except Exception:
                    logger.exception("Demo agent tick failed for session %s", session.namespace)
            return blocked

    def stop(self) -> None:
        for worker_id in list(self._attempts):
            self._stop_worker(worker_id)
