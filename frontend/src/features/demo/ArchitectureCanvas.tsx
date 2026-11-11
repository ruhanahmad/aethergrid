import { Activity, ArrowRight, Braces, Database, FileText, KeyRound, Layers3, Server, Workflow } from "lucide-react";
import type { DemoAgent, DemoSnapshot } from "./api";
import { statusTone, timeLabel } from './format';
import { Pill } from './ui';

const stages = [
  ["Frontend", FileText], ["API", Braces], ["Job queue", Database], ["Scheduler", Workflow],
  ["Node", Server], ["Worker", Layers3], ["Lease", KeyRound], ["Execution", Activity],
] as const;

const eventStage: Record<string, string> = {
  JobCreated: "Job queue", JobScheduled: "Scheduler", WorkerAssigned: "Worker",
  LeaseAcquired: "Lease", LeaseReleased: "Lease", DemoReportStarted: "Execution",
  JobReclaimed: "Job queue", JobUnscheduled: "Job queue", DemoNodeOffline: "Node", DemoWorkerOffline: "Worker",
  DemoWorkerInterrupted: "Worker", DemoWorkerRestored: "Worker",
  JobCompleted: "Execution", JobFailed: "Execution", JobCancelled: "Execution", DemoReportGenerated: "Execution",
  DemoLeaseRenewed: "Lease", DemoStaleLeaseRejected: "Lease",
};

function AgentCard({ agent, interrupted }: { agent: DemoAgent; interrupted: boolean }) {
  return (
    <article className={`min-w-0 rounded-xl border p-4 ${interrupted ? "border-rose-400/30 bg-rose-500/5" : "border-slate-700/70 bg-slate-950/55"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-slate-100"><Server size={16} /> Node {agent.slot}</h3>
        <Pill tone={agent.node_online ? "healthy" : agent.node_online === false ? "danger" : "neutral"}>
          {agent.node_online ? "Online" : agent.node_online === false ? "Offline" : "Unprovisioned"}
        </Pill>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {agent.cpu_cores ?? "—"} vCPU · {agent.memory_mib ?? "—"} MiB declared · Heartbeat {timeLabel(agent.node_last_seen_at)}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-slate-500">{agent.node_id}</p>
      <div className="mt-4 border-t border-slate-800 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium text-slate-100">Worker {agent.slot}</h4>
          <Pill tone={statusTone(agent.worker_status)}>{agent.worker_status ?? "Unprovisioned"}</Pill>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {interrupted ? "Heartbeat and execution interrupted" : "Heartbeat"} · {timeLabel(agent.worker_last_seen_at)}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-slate-500">{agent.worker_id}</p>
        {agent.lease && <p className="mt-3 break-all text-xs text-cyan-100">
          Lease <span className="font-mono">{agent.lease.id}</span> · Expires {timeLabel(agent.lease.expires_at)}
        </p>}
      </div>
    </article>
  );
}

export function ArchitectureCanvas({ snapshot, submitting, presented }: {
  snapshot: DemoSnapshot | null;
  submitting: boolean;
  presented: boolean;
}) {
  const job = snapshot?.job;
  const latest = snapshot?.events.at(-1);
  const activeStage = submitting ? "API" : eventStage[latest?.type ?? ""] ??
    (job?.status === "QUEUED" ? "Job queue" : null);
  const failure = !submitting && ["DemoWorkerInterrupted", "DemoWorkerOffline", "DemoNodeOffline", "JobFailed"]
    .includes(latest?.type ?? "");
  const finished = !submitting && ["JobCompleted", "DemoReportGenerated"].includes(latest?.type ?? "");
  const activeStyle = failure ? "border-rose-300/70 bg-rose-300/10 text-rose-100"
    : finished ? "border-emerald-300/70 bg-emerald-300/10 text-emerald-100"
    : "border-cyan-300/70 bg-cyan-300/10 text-cyan-100";
  const assigned = snapshot?.agents.find((agent) => agent.worker_job_id === job?.id);
  const lastWorker = snapshot?.events.findLast((event) => event.type === "DemoReportStarted")?.details.slot;
  const recovering = job?.status === "QUEUED" && job.retry_count > 0;

  return (
    <section id="demo-architecture" tabIndex={-1} aria-labelledby="demo-architecture-title"
      className={`scroll-mt-4 rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-900 via-[#101a2d] to-slate-950 shadow-lg shadow-black/20 ${presented ? "p-5 lg:p-10" : "p-4 lg:p-6"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="demo-architecture-title" className={`font-semibold text-white ${presented ? "text-3xl" : "text-xl"}`}>Live execution path</h2>
          <p className="mt-1 text-sm text-slate-400">The scheduler pulls queued work and assigns it to an eligible worker.</p>
        </div>
        <Pill tone={statusTone(job?.status)}>{recovering ? "Queued for recovery" : job?.status ?? "Awaiting request"}</Pill>
      </div>
      <ol className={`mt-6 grid grid-cols-2 gap-3 ${presented ? "sm:grid-cols-4 2xl:grid-cols-8" : "lg:grid-cols-4"}`}>
        {stages.map(([stage, Icon], index) => {
          const active = activeStage === stage;
          return <li key={stage} aria-current={active ? "step" : undefined}
            className={`relative min-w-0 overflow-hidden rounded-xl border p-3 motion-safe:transition-colors ${active ? activeStyle : "border-slate-700/70 bg-slate-950/50 text-slate-400"}`}>
            <div className="flex items-center justify-between gap-2">
              <Icon size={presented ? 24 : 19} aria-hidden="true" />
              {index < stages.length - 1 && <ArrowRight size={14} aria-hidden="true" className="opacity-60" />}
            </div>
            <p className="mt-2 text-sm font-semibold">{stage}</p>
            {active && <span key={submitting ? "request" : latest?.id} aria-hidden="true" className="demo-flow-indicator absolute bottom-0 left-0 h-0.5 w-1/3 rounded-full bg-current" />}
          </li>;
        })}
      </ol>
      {job && <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 break-all text-xs text-slate-300">
        <span>Job <span className="font-mono text-slate-100">{job.id}</span></span>
        <span>{assigned ? `Assigned to Worker ${assigned.slot}` : lastWorker ? `Last ran on Worker ${lastWorker}` : "Awaiting assignment"}</span>
        <span>Retries used {job.retry_count} of {job.max_retries}</span>
        <span>{job.cpu_cores} vCPU · {job.memory_mib} MiB requested</span>
      </div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {snapshot?.agents.map((agent) => <AgentCard key={agent.slot} agent={agent}
          interrupted={agent.slot === "A" && Boolean(snapshot.session.interrupted_at) && !snapshot.session.archived_at} />)}
      </div>
    </section>
  );
}
