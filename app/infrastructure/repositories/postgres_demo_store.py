from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.application.services.demo_store import DemoSession
from app.domain.value_objects.tenant_id import TenantId

# Two-int advisory locks occupy a separate key space from scheduler leadership.
_DEMO_LOCK = (174732005, 1)


class PostgresDemoStore:
    def __init__(self, pool: ConnectionPool) -> None:
        self._pool = pool

    @contextmanager
    def guard(self) -> Iterator[bool]:
        # Serialize API mutations with the leader's agent tick across processes.
        # Try instead of waiting while holding a connection from the shared pool.
        with self._pool.connection() as conn, conn.transaction():
            row = conn.execute("SELECT pg_try_advisory_xact_lock(%s, %s)", _DEMO_LOCK).fetchone()
            yield bool(row and row[0])

    def create(self, session: DemoSession) -> None:
        tenant = session.tenant()
        with self._pool.connection() as conn, conn.transaction():
            conn.execute(
                "INSERT INTO tenants (id, name, created_at) VALUES (%s, %s, %s)",
                (tenant.id.value, tenant.name, tenant.created_at),
            )
            conn.execute(
                """
                INSERT INTO demo_sessions (namespace_id, owner_tenant_id, created_at)
                VALUES (%s, %s, %s)
                """,
                (session.namespace.value, session.owner.value, session.created_at),
            )

    def save(self, session: DemoSession) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                """
                UPDATE demo_sessions SET interrupted_at = %s, archived_at = %s
                WHERE namespace_id = %s AND owner_tenant_id = %s
                """,
                (
                    session.interrupted_at,
                    session.archived_at,
                    session.namespace.value,
                    session.owner.value,
                ),
            )

    def get(self, owner: TenantId, namespace: TenantId) -> DemoSession | None:
        with self._pool.connection() as conn:
            row = (
                conn.cursor(row_factory=dict_row)
                .execute(
                    "SELECT * FROM demo_sessions WHERE owner_tenant_id = %s AND namespace_id = %s",
                    (owner.value, namespace.value),
                )
                .fetchone()
            )
        return self._session(row) if row is not None else None

    def list_for(self, owner: TenantId) -> list[DemoSession]:
        with self._pool.connection() as conn:
            rows = (
                conn.cursor(row_factory=dict_row)
                .execute(
                    """
                SELECT * FROM demo_sessions WHERE owner_tenant_id = %s
                ORDER BY created_at DESC
                """,
                    (owner.value,),
                )
                .fetchall()
            )
        return [self._session(row) for row in rows]

    def active(self) -> list[DemoSession]:
        with self._pool.connection() as conn:
            rows = (
                conn.cursor(row_factory=dict_row)
                .execute(
                    "SELECT * FROM demo_sessions WHERE archived_at IS NULL ORDER BY created_at",
                )
                .fetchall()
            )
        return [self._session(row) for row in rows]

    @staticmethod
    def _session(row: dict[str, Any]) -> DemoSession:
        return DemoSession(
            namespace=TenantId(row["namespace_id"]),
            owner=TenantId(row["owner_tenant_id"]),
            created_at=row["created_at"],
            interrupted_at=row["interrupted_at"],
            archived_at=row["archived_at"],
        )
