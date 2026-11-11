CREATE TABLE demo_sessions (
    namespace_id UUID PRIMARY KEY REFERENCES tenants(id),
    owner_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    interrupted_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    CHECK (namespace_id <> owner_tenant_id)
);

CREATE INDEX demo_sessions_owner_created_idx
    ON demo_sessions (owner_tenant_id, created_at DESC);

CREATE INDEX demo_sessions_active_idx
    ON demo_sessions (created_at) WHERE archived_at IS NULL;
