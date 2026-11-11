from __future__ import annotations

from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import datetime
from threading import RLock
from typing import Protocol

from app.domain.entities.tenant import Tenant
from app.domain.repositories.tenant_repository import TenantRepository
from app.domain.value_objects.tenant_id import TenantId


@dataclass(frozen=True, slots=True)
class DemoSession:
    namespace: TenantId
    owner: TenantId
    created_at: datetime
    interrupted_at: datetime | None = None
    archived_at: datetime | None = None

    def tenant(self) -> Tenant:
        return Tenant(self.namespace, f"demo-{self.namespace}", self.created_at)


class DemoStore(Protocol):
    def guard(self) -> AbstractContextManager[bool]: ...
    def create(self, session: DemoSession) -> None: ...
    def save(self, session: DemoSession) -> None: ...
    def get(self, owner: TenantId, namespace: TenantId) -> DemoSession | None: ...
    def list_for(self, owner: TenantId) -> list[DemoSession]: ...
    def active(self) -> list[DemoSession]: ...


class InMemoryDemoStore:
    def __init__(self, tenants: TenantRepository) -> None:
        self._tenants = tenants
        self._lock = RLock()
        self._sessions: dict[TenantId, DemoSession] = {}

    @contextmanager
    def guard(self) -> Iterator[bool]:
        with self._lock:
            yield True

    def create(self, session: DemoSession) -> None:
        self._tenants.save(session.tenant())
        self.save(session)

    def save(self, session: DemoSession) -> None:
        with self._lock:
            self._sessions[session.namespace] = session

    def get(self, owner: TenantId, namespace: TenantId) -> DemoSession | None:
        with self._lock:
            session = self._sessions.get(namespace)
            return session if session and session.owner == owner else None

    def list_for(self, owner: TenantId) -> list[DemoSession]:
        with self._lock:
            return [s for s in reversed(self._sessions.values()) if s.owner == owner]

    def active(self) -> list[DemoSession]:
        with self._lock:
            return [s for s in self._sessions.values() if s.archived_at is None]
