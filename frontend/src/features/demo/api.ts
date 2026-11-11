import { apiWithStatus } from "../../api/client";

export interface DemoSession {
  id: string;
  created_at: string;
  interrupted_at: string | null;
  archived_at: string | null;
}

export interface DemoJob {
  id: string;
  status: string;
  assigned_node_id: string | null;
  retry_count: number;
  max_retries: number;
  cpu_cores: number;
  memory_mib: number;
  exit_code: number | null;
}

export interface DemoLease {
  id: string;
  job_id: string;
  acquired_at: string;
  expires_at: string;
  current: boolean;
}

export interface DemoAgent {
  slot: string;
  node_id: string | null;
  node_online: boolean | null;
  node_last_seen_at: string | null;
  worker_id: string | null;
  worker_status: string | null;
  worker_last_seen_at: string | null;
  worker_job_id: string | null;
  cpu_cores: number | null;
  memory_mib: number | null;
  lease: DemoLease | null;
}

export interface DemoEvent {
  id: string;
  resource_id: string;
  type: string;
  occurred_at: string;
  details: Record<string, string>;
}

export interface DemoSnapshot {
  session: DemoSession;
  agents: DemoAgent[];
  job: DemoJob | null;
  events: DemoEvent[];
}

export type DemoAction = "interrupt" | "restore" | "restart" | "archive" | "stale-a" | "stale-b";

const endpoint = "/demo/sessions";
export const reportPath = (id: string) => `${endpoint}/${encodeURIComponent(id)}/report`;
export const listRuns = (signal?: AbortSignal) => apiWithStatus<DemoSession[]>(endpoint, { signal });
export const getRun = (id: string, signal?: AbortSignal) =>
  apiWithStatus<DemoSnapshot>(`${endpoint}/${encodeURIComponent(id)}`, { signal });
export const startRun = () => apiWithStatus<DemoSession>(endpoint, { method: "POST" });
export const submitReport = (id: string) =>
  apiWithStatus<DemoJob>(reportPath(id), { method: "POST" });
export const changeRun = (id: string, action: DemoAction) =>
  apiWithStatus<DemoSession>(`${endpoint}/${encodeURIComponent(id)}/${action}`, { method: "POST" });
