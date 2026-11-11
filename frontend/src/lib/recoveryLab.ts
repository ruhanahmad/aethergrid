import type { CreateJobRequest } from "../api/jobs";
import type { JobStatus } from "../api/types";

type HeartbeatTarget = "node" | "worker";

function pauseKey(kind: HeartbeatTarget, id: string) {
  return `aethergrid:recovery-lab:paused:${kind}:${id}`;
}

export function isLabHeartbeatPaused(kind: HeartbeatTarget, id: string) {
  return localStorage.getItem(pauseKey(kind, id)) === "true";
}

export function setLabHeartbeatPaused(kind: HeartbeatTarget, id: string, paused: boolean) {
  const key = pauseKey(kind, id);
  if (paused) {
    localStorage.setItem(key, "true");
  } else {
    localStorage.removeItem(key);
  }
}

export type LabJob = "success" | "failure" | "slow" | "oversized";

const commands = {
  success: ["python", "-c", "print('Recovery Lab completed')"],
  failure: ["python", "-c", "raise SystemExit(1)"],
  slow: ["python", "-c", "import time; time.sleep(120)"],
};

export function labJobRequest(kind: LabJob, largestNodeCpu: number): CreateJobRequest {
  if (kind === "oversized") {
    return { cpu_cores: largestNodeCpu + 1, memory_mib: 128, vram_mib: 0 };
  }
  return { cpu_cores: 1, memory_mib: 128, vram_mib: 0, command: commands[kind] };
}

export function canCancelLabJob(status: JobStatus) {
  return ["SUBMITTED", "QUEUED", "SCHEDULED", "RUNNING"].includes(status);
}

export function isTerminalLabJob(status: JobStatus) {
  return ["COMPLETED", "FAILED", "CANCELLED"].includes(status);
}

export function incorrectLeaseId(current: string) {
  const candidate = "00000000-0000-4000-8000-000000000000";
  return candidate === current ? "00000000-0000-4000-8000-000000000001" : candidate;
}
