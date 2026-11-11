import type { DemoEvent } from "./api";
import { timeLabel } from "./format";

const descriptions: Record<string, string> = {
  JobCreated: "The API queued the report for processing.",
  JobScheduled: "The scheduler reserved capacity on an eligible node.",
  WorkerAssigned: "The scheduler assigned a worker.",
  LeaseAcquired: "The worker received temporary ownership of the report.",
  DemoReportStarted: "The report agent began processing the order batches.",
  DemoWorkerInterrupted: "The backend stopped Worker A's report task, heartbeats, and lease renewals.",
  DemoWorkerOffline: "The backend marked Worker A offline after its heartbeats stopped.",
  DemoNodeOffline: "Node A's last heartbeat exceeded the node timeout.",
  JobReclaimed: "Reconciliation reclaimed the job after loss of ownership.",
  DemoWorkerRestored: "The backend accepted fresh Node A and Worker A heartbeats.",
  JobUnscheduled: "The scheduler returned the job to the queue.",
  DemoStaleLeaseRejected: "The lease service refused to extend ownership for a different lease ID.",
  DemoLeaseRenewed: "The lease service extended the current worker's claim.",
  LeaseReleased: "The worker's claim ended.",
  DemoReportGenerated: "The agent returned a revenue total from the report batches.",
  JobCompleted: "The backend accepted the worker's completed result.",
  JobFailed: "The backend recorded a failed report attempt.",
  JobCancelled: "The backend recorded the cancellation.",
};

export function EventTimeline({ events }: { events: DemoEvent[] }) {
  return <section id="demo-timeline" tabIndex={-1} aria-labelledby="demo-timeline-title"
    className="scroll-mt-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="demo-timeline-title" className="text-lg font-semibold text-white">Execution timeline</h2>
      <span className="text-xs text-slate-400">{events.length} backend events</span>
    </div>
    {!events.length ? <p className="mt-4 text-sm text-slate-400">Submit a report to see recorded events here.</p> :
      <ol className="ml-1 mt-5 space-y-4 border-l border-slate-700 pl-4">
        {events.map((event) => <li key={event.id} className="relative">
          <span aria-hidden="true" className="absolute -left-[21px] top-2 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-cyan-300" />
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">
              {event.type}
              <time dateTime={event.occurred_at} className="ml-3 whitespace-nowrap font-normal text-slate-400">{timeLabel(event.occurred_at)}</time>
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
              {JSON.stringify({ event_id: event.id, resource_id: event.resource_id, occurred_at: event.occurred_at, ...event.details }, null, 2)}
            </pre>
          </details>
          <p className="mt-1 text-sm text-slate-400">
            {event.details.slot ? `Worker ${event.details.slot} · ` : ""}{descriptions[event.type] ?? "Recorded by the backend."}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{event.resource_id}</p>
        </li>)}
      </ol>}
  </section>;
}
