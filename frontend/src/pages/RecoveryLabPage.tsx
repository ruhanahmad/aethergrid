import { useRef, useState, type ComponentProps } from "react";
import { getApiKey } from "../api/authKey";
import { ApiError } from "../api/client";
import { fetchNodes } from "../api/dashboard";
import { cancelJob, createJob, getJob, getJobHistory, listJobs, retryJob } from "../api/jobs";
import { createNode, heartbeatNode, removeOfflineNode } from "../api/nodes";
import { createWorker, getWorker, heartbeatWorker, listWorkers, renewWorkerLease } from "../api/workers";
import type { EventResponse, WorkerStatus } from "../api/types";
import { StatusBadge } from "../components/common/StatusBadge";
import { SectionCard } from "../components/dashboard/SectionCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import {
  canCancelLabJob, incorrectLeaseId, isLabHeartbeatPaused, isTerminalLabJob,
  labJobRequest, setLabHeartbeatPaused, type LabJob,
} from "../lib/recoveryLab";

const manifestKey = "aethergrid:recovery-lab:resources";
const poll = { pollIntervalMs: 5_000, resetLoadingOnRefresh: false };
const slots = ["A", "B"] as const;
const workerBadges = {
  BUSY: "Busy", DRAINING: "Draining", IDLE: "Idle", OFFLINE: "Offline", STARTING: "Starting",
} satisfies Record<WorkerStatus, ComponentProps<typeof StatusBadge>["status"]>;
type Slot = (typeof slots)[number];
type Manifest = {
  nodes: Partial<Record<Slot, string>>;
  workers: string[];
  jobs: string[];
};

function readManifest(): Manifest {
  const saved = sessionStorage.getItem(manifestKey);
  try {
    if (saved) return JSON.parse(saved) as Manifest;
  } catch {
    // A malformed session record cannot establish ownership.
  }
  return { nodes: {}, workers: [], jobs: [] };
}

async function loadCluster() {
  const [nodes, workers, jobs] = await Promise.all([fetchNodes(), listWorkers(), listJobs()]);
  return { nodes: nodes.nodes, workers: workers.workers, jobs: jobs.jobs };
}

async function loadWorkerObservation(workerId: string) {
  const worker = await getWorker(workerId);
  return { worker, observedAt: Date.now() };
}

function LabButton(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-40"
      {...props}
    />
  );
}

const eventDescriptions: Record<string, string> = {
  JobCreated: "The cluster accepted the job.",
  JobScheduled: "The scheduler reserved capacity for this job.",
  WorkerAssigned: "A worker took responsibility for the job.",
  LeaseAcquired: "The worker received a time-limited claim to run the job.",
  LeaseReleased: "The worker's claim ended.",
  JobCompleted: "The job finished successfully.",
  JobFailed: "The backend recorded an unsuccessful attempt.",
  JobCancelled: "The backend recorded the cancellation.",
  JobReclaimed: "Reconciliation recovered an abandoned job.",
  JobUnscheduled: "The scheduler returned the job to the queue.",
};

function Timeline({ events }: { events: EventResponse[] }) {
  return (
    <ol className="space-y-4 border-l border-slate-700 pl-4">
      {[...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)).map((event) => (
        <li key={event.id} className="relative">
          <span aria-hidden="true" className="absolute -left-5 top-1.5 h-2 w-2 rounded-full bg-sky-400" />
          <p className="font-medium text-slate-100">{event.event_type}</p>
          <time dateTime={event.occurred_at} className="text-xs text-slate-400">
            {new Date(event.occurred_at).toLocaleString()}
          </time>
          <p>{eventDescriptions[event.event_type] ?? "Recorded by the backend for this job."}</p>
        </li>
      ))}
    </ol>
  );
}

function RecoveryLab() {
  const [manifest, setManifest] = useState(readManifest);
  const [jobId, setJobId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [busy, setBusy] = useState(false);
  const actionInProgress = useRef(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [leaseResult, setLeaseResult] = useState<{ workerId: string; text: string }>();
  const cluster = useAsyncResource(loadCluster, [], { pollIntervalMs: poll.pollIntervalMs });
  const nodes = cluster.data?.nodes ?? [];
  const workers = cluster.data?.workers ?? [];
  const jobs = (cluster.data?.jobs ?? []).filter((job) => manifest.jobs.includes(job.id));
  const labWorkers = workers.filter((worker) =>
    manifest.workers.includes(worker.id) && Object.values(manifest.nodes).includes(worker.node_id),
  );
  const hasOnlineWorker = labWorkers.some((worker) =>
    (worker.status === "IDLE" || worker.status === "BUSY") &&
    nodes.some((node) => node.id === worker.node_id && node.is_alive && !node.is_draining),
  );
  const selectedJob = jobs.find((job) => job.id === jobId);
  const selectedWorker = labWorkers.find((worker) => worker.id === workerId);
  const assignment = selectedJob && workers.find((worker) => worker.running_job_id === selectedJob.id);
  const lease = useAsyncResource(
    () => selectedWorker ? loadWorkerObservation(selectedWorker.id) : Promise.resolve(null),
    [selectedWorker?.id], poll,
  );
  const history = useAsyncResource(
    async () => selectedJob ? { id: selectedJob.id, ...(await getJobHistory(selectedJob.id)) } : null,
    [selectedJob?.id], poll,
  );
  const observation = selectedWorker && lease.data?.worker.id === selectedWorker.id ? lease.data : null;
  const running = observation?.worker.running_job;
  const currentLease = Boolean(running?.lease_id && running.lease_expires_at &&
    Date.parse(running.lease_expires_at) > (observation?.observedAt ?? 0));
  const canTestLease = currentLease && running && manifest.jobs.includes(running.id);

  function remember(next: Manifest) {
    sessionStorage.setItem(manifestKey, JSON.stringify(next));
    setManifest(next);
  }

  async function run(action: (checkAuth: () => void) => Promise<string>) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    const key = getApiKey();
    function checkAuth() {
      if (!key || key !== getApiKey()) throw new Error("The dashboard session changed. Sign in and try again.");
    }
    setBusy(true);
    setMessage("");
    setFailure("");
    try {
      checkAuth();
      setMessage(await action(checkAuth));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The action failed.");
    } finally {
      actionInProgress.current = false;
      setBusy(false);
      cluster.refresh();
      lease.refresh();
      history.refresh();
    }
  }

  async function checkIsolation(checkAuth: () => void) {
    const snapshot = await loadCluster();
    checkAuth();
    const unrelated = snapshot.nodes.some((node) => !Object.values(manifest.nodes).includes(node.id))
      || snapshot.workers.some((worker) => !manifest.workers.includes(worker.id))
      || snapshot.jobs.some((job) => !manifest.jobs.includes(job.id));
    if (unrelated) {
      throw new Error("This tenant contains resources outside this lab session. Use an empty demo tenant.");
    }
    return snapshot;
  }

  function registerNode(slot: Slot) {
    void run(async (checkAuth) => {
      await checkIsolation(checkAuth);
      const node = await createNode({
        cpu_cores: slot === "A" ? 2 : 4,
        memory_mib: slot === "A" ? 2048 : 4096,
        vram_mib: slot === "A" ? 0 : 1024,
      });
      remember({ ...manifest, nodes: { ...manifest.nodes, [slot]: node.id } });
      return `Test Node ${slot} registered.`;
    });
  }

  function registerWorker(nodeId: string) {
    void run(async (checkAuth) => {
      const snapshot = await checkIsolation(checkAuth);
      if (!snapshot.nodes.some((node) => node.id === nodeId && node.is_alive && !node.is_draining)) {
        throw new Error("The lab node must be online and accepting work.");
      }
      const worker = await createWorker({ node_id: nodeId });
      remember({ ...manifest, workers: [...manifest.workers, worker.id] });
      setWorkerId(worker.id);
      return `Worker registered with status ${worker.status}.`;
    });
  }

  function submit(kind: LabJob) {
    void run(async (checkAuth) => {
      const snapshot = await checkIsolation(checkAuth);
      const largestNodeCpu = Math.max(0, ...snapshot.nodes.map((node) => node.cpu_cores));
      const job = await createJob(labJobRequest(kind, largestNodeCpu));
      remember({ ...manifest, jobs: [...manifest.jobs, job.id] });
      setJobId(job.id);
      return `The backend accepted the job with status ${job.status}.`;
    });
  }

  function toggleHeartbeat(kind: "node" | "worker", id: string) {
    void run(async () => {
      if (!isLabHeartbeatPaused(kind, id)) {
        setLabHeartbeatPaused(kind, id, true);
        return `Test ${kind} heartbeats paused. Watch for the offline status after the server timeout.`;
      }
      await (kind === "node" ? heartbeatNode(id) : heartbeatWorker(id));
      setLabHeartbeatPaused(kind, id, false);
      return `The backend accepted the test ${kind} heartbeat. Automatic heartbeats resumed.`;
    });
  }

  function reset() {
    if (!window.confirm("Cancel active lab jobs and retire the test nodes and workers? Job history will remain available.")) return;
    void run(async (checkAuth) => {
      const snapshot = await checkIsolation(checkAuth);
      for (const id of manifest.workers) setLabHeartbeatPaused("worker", id, true);
      for (const id of Object.values(manifest.nodes)) setLabHeartbeatPaused("node", id, true);

      // The dashboard list is capped. Check any older tracked jobs individually.
      const olderJobs = manifest.jobs.filter((id) => !snapshot.jobs.some((job) => job.id === id));
      const trackedJobs = [...snapshot.jobs];
      for (const id of olderJobs) {
        checkAuth();
        try {
          trackedJobs.push(await getJob(id));
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      const unsettled = [];
      for (const job of trackedJobs) {
        let status = job.status;
        if (canCancelLabJob(job.status)) {
          checkAuth();
          status = (await cancelJob(job.id)).status;
        }
        if (!isTerminalLabJob(status)) unsettled.push(job.id);
      }

      const latest = await checkIsolation(checkAuth);
      if (unsettled.length
        || latest.jobs.some((job) => !isTerminalLabJob(job.status))
        || latest.nodes.some((node) => node.is_alive)
        || latest.workers.some((worker) => worker.status !== "OFFLINE" || worker.running_job_id)) {
        return "Reset started. Keep the dashboard open and select Reset demonstration again once lab nodes and workers are offline and jobs have settled.";
      }

      let remaining = { ...manifest.nodes };
      for (const slot of slots) {
        const id = remaining[slot];
        if (!id) continue;
        checkAuth();
        if (latest.nodes.some((node) => node.id === id)) await removeOfflineNode(id);
        setLabHeartbeatPaused("node", id, false);
        remaining = { ...remaining, [slot]: undefined };
        remember({ ...manifest, nodes: remaining });
      }
      setWorkerId("");
      return "Test nodes removed. Retired workers may remain offline in the backend. Lab job history is retained.";
    });
  }

  function testLease() {
    if (!canTestLease || !selectedWorker || !running?.lease_id) return;
    const id = selectedWorker.id;
    const leaseId = running.lease_id;
    setLeaseResult(undefined);
    void run(async (checkAuth) => {
      const fresh = await getWorker(id);
      checkAuth();
      if (fresh.running_job?.lease_id !== leaseId ||
        !fresh.running_job.lease_expires_at || Date.parse(fresh.running_job.lease_expires_at) <= Date.now()) {
        throw new Error("The inspected lease changed or expired. Select a worker with a current lease and try again.");
      }
      try {
        const result = await renewWorkerLease(id, incorrectLeaseId(leaseId));
        setLeaseResult({ workerId: id, text: `HTTP ${result.status}. The backend unexpectedly accepted the incorrect lease ID.` });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const detail = error.status === 409
          ? "The backend rejected the renewal. A caller must hold the current lease ID to extend its claim."
          : "The renewal request did not complete. Check access and worker availability.";
        setLeaseResult({ workerId: id, text: `HTTP ${error.status}. ${detail}` });
      }
      return "";
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 text-sm text-slate-300">
      <header>
        <h1 className="text-3xl font-semibold text-white">Recovery Lab</h1>
        <p className="mt-2">Run test jobs and watch how an isolated AetherGrid cluster responds when heartbeats stop.</p>
      </header>
      <div aria-live="polite" className="space-y-1">
        {(busy || cluster.loading) && <p>Working…</p>}
        {message && <p className="text-sky-300">{message}</p>}
        {(failure || cluster.error) && <p role="alert" className="text-rose-300">{failure || cluster.error}</p>}
      </div>
      <SectionCard title="Test environment" subtitle="Node capacities are simulated. Job commands run on the backend host.">
        <div className="mb-4 flex flex-wrap gap-2">
          <LabButton disabled={busy || cluster.loading} onClick={cluster.refresh}>Refresh cluster state</LabButton>
          <LabButton disabled={busy || (!jobs.length && !Object.values(manifest.nodes).some(Boolean))} onClick={reset}>
            Reset demonstration
          </LabButton>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {slots.map((slot) => {
            const node = nodes.find((item) => item.id === manifest.nodes[slot]);
            const attached = labWorkers.filter((worker) => worker.node_id === node?.id);
            return (
              <div key={slot} className="min-w-0 space-y-2 rounded-lg border border-slate-800 p-4">
                <h3 className="font-semibold text-white">Test Node {slot}</h3>
                {node ? (
                  <>
                    <p className="break-all font-mono text-xs">{node.id}</p>
                    <StatusBadge status={node.is_alive ? node.is_draining ? "Draining" : "Healthy" : "Offline"} />
                    <p>{node.cpu_cores} CPU cores · {node.memory_mib} MiB RAM · {node.vram_mib} MiB VRAM</p>
                    {attached.map((worker) => (
                      <div key={worker.id} className="flex flex-wrap items-center gap-2 break-all">
                        <span>Worker <span className="font-mono text-xs">{worker.id}</span></span>
                        <StatusBadge status={workerBadges[worker.status]} />
                      </div>
                    ))}
                    <LabButton disabled={busy || !node.is_alive || node.is_draining || attached.length > 0}
                      onClick={() => registerWorker(node.id)}>Register test worker</LabButton>
                  </>
                ) : (
                  <LabButton disabled={busy || cluster.loading || Boolean(manifest.nodes[slot])}
                    onClick={() => registerNode(slot)}>Register Test Node {slot}</LabButton>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Job testing" subtitle="Register an online test node and a worker, then submit a job. The slow job runs for two minutes if left uninterrupted.">
        <div className="flex flex-wrap gap-2">
          <LabButton disabled={busy || !hasOnlineWorker} onClick={() => submit("success")}>Run successful test job</LabButton>
          <LabButton disabled={busy || !hasOnlineWorker} onClick={() => submit("failure")}>Run failed test job</LabButton>
          <LabButton disabled={busy || !hasOnlineWorker} onClick={() => submit("slow")}>Run slow job</LabButton>
          <LabButton disabled={busy || !nodes.length} onClick={() => submit("oversized")}>Submit oversized job</LabButton>
        </div>
        <label className="mt-4 block">
          Lab job
          <select className="mt-1 block w-full rounded bg-slate-800 p-2" value={selectedJob?.id ?? ""} onChange={(event) => setJobId(event.target.value)}>
            <option value="">Select a lab job</option>
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.status} · {job.id}</option>)}
          </select>
        </label>
        {selectedJob && (
          <div className="mt-3 space-y-3 break-all">
            <p><span className="rounded bg-slate-800 px-2 py-1">{selectedJob.status}</span> · {selectedJob.id}</p>
            <p>{selectedJob.cpu_cores} CPU cores · {selectedJob.memory_mib} MiB RAM · {selectedJob.vram_mib} MiB VRAM</p>
            <p>Current worker {assignment?.id ?? "—"}{selectedJob.exit_code !== null && ` · Exit code ${selectedJob.exit_code}`}</p>
            <div className="flex flex-wrap gap-2">
              <LabButton disabled={busy || !canCancelLabJob(selectedJob.status)} onClick={() => {
                if (window.confirm("Cancel this lab job?")) {
                  void run(async () => `Backend status: ${(await cancelJob(selectedJob.id)).status}.`);
                }
              }}>Cancel job</LabButton>
              <LabButton disabled={busy || selectedJob.status !== "FAILED"} onClick={() => void run(async (checkAuth) => {
                await checkIsolation(checkAuth);
                const result = await retryJob(selectedJob.id);
                return result.status === "FAILED"
                  ? "The backend left the job failed. It may have exhausted its retry budget."
                  : `Backend status: ${result.status}.`;
              })}>Retry failed job</LabButton>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Worker failure and recovery" subtitle="Pause heartbeats and watch the offline status and job timeline. The backend controls timeout and reconciliation.">
        <p className="mb-3">Choose a worker in the lease inspector to control its heartbeats. Pausing stops dashboard heartbeats, and the execution loop can still renew a running job's lease. Draining prevents new scheduling. A process-crash exercise requires a standalone test agent.</p>
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => {
            const id = manifest.nodes[slot];
            if (!id || !nodes.some((node) => node.id === id)) return null;
            return <LabButton key={id} disabled={busy} onClick={() => toggleHeartbeat("node", id)}>
              {isLabHeartbeatPaused("node", id) ? "Resume" : "Pause"} Test Node {slot} heartbeats
            </LabButton>;
          })}
          <LabButton disabled={busy || !selectedWorker} onClick={() => selectedWorker && toggleHeartbeat("worker", selectedWorker.id)}>
            {selectedWorker && isLabHeartbeatPaused("worker", selectedWorker.id) ? "Resume" : "Pause"} selected worker heartbeats
          </LabButton>
        </div>
      </SectionCard>

      <SectionCard title="Lease inspector">
        <label className="block">
          Lab worker
          <select className="mt-1 block w-full rounded bg-slate-800 p-2" value={selectedWorker?.id ?? ""} onChange={(event) => setWorkerId(event.target.value)}>
            <option value="">Select a lab worker</option>
            {labWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.status} · {worker.id}</option>)}
          </select>
        </label>
        {selectedWorker && (
          <div className="mt-3 space-y-3">
            {lease.error && <p role="alert">{lease.error}</p>}
            <dl className="grid gap-2 break-all sm:grid-cols-[auto_1fr]">
              <dt>Worker ID</dt><dd>{selectedWorker.id}</dd>
              <dt>Assigned job</dt><dd>{running?.id ?? "—"}</dd>
              <dt>Lease ID</dt><dd>{running?.lease_id ?? "—"}</dd>
              <dt>Acquired</dt><dd>{running?.lease_acquired_at ? new Date(running.lease_acquired_at).toLocaleString() : "—"}</dd>
              <dt>Expires</dt><dd>{running?.lease_expires_at ? new Date(running.lease_expires_at).toLocaleString() : "—"}</dd>
              <dt>Lease status</dt><dd>{lease.error ? "Unavailable" : !observation ? "Loading…" : currentLease ? "Current" : running?.lease_id ? "Expired" : "No lease"}</dd>
            </dl>
            <LabButton disabled={busy || Boolean(lease.error) || !canTestLease} onClick={testLease}>Test Stale Lease</LabButton>
            {leaseResult?.workerId === selectedWorker.id && <p role="status">{leaseResult.text}</p>}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Job timeline">
        {!selectedJob ? <p>Select a lab job to view its event history.</p>
          : history.error ? <p role="alert">{history.error}</p>
          : history.data?.id !== selectedJob.id ? <p>Loading events…</p>
          : history.data.events.length ? <Timeline events={history.data.events} />
          : <p>The backend has recorded no events for this job yet.</p>}
      </SectionCard>
    </div>
  );
}

export default function RecoveryLabPage() {
  if (import.meta.env.VITE_RECOVERY_LAB_ENABLED !== "true") {
    return (
      <SectionCard title="Recovery Lab">
        <p className="text-slate-300">To enable lab controls, set VITE_RECOVERY_LAB_ENABLED=true and connect to an isolated demo tenant.</p>
      </SectionCard>
    );
  }
  return <RecoveryLab />;
}
