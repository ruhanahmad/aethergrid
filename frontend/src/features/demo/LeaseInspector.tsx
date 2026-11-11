import { KeyRound } from "lucide-react";
import type { DemoAgent } from "./api";
import { timeLabel } from "./format";
import { DemoButton, Pill } from "./ui";

export function LeaseInspector({ agents, busy, archived, testLease, result }: {
  agents: DemoAgent[];
  busy: boolean;
  archived: boolean;
  testLease: (slot: string) => void;
  result: string;
}) {
  return <details id="demo-lease" className="scroll-mt-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
    <summary className="cursor-pointer text-lg font-semibold text-white">Lease inspector</summary>
    <p className="mt-2 text-sm text-slate-400">A lease binds a worker to a job until its expiry. Renewals must present the current lease ID.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {agents.map((agent) => <div key={agent.slot} className="min-w-0 rounded-xl border border-slate-700/70 bg-slate-950/50 p-4">
        <p className="mb-2 flex items-center gap-2 font-semibold text-slate-100"><KeyRound size={16} aria-hidden="true" /> Worker {agent.slot}</p>
        {agent.lease ? <>
          <Pill tone={agent.lease.current ? "healthy" : "danger"}>{agent.lease.current ? "Current lease" : "Expired lease"}</Pill>
          <dl className="mt-3 grid gap-x-3 gap-y-1 break-all text-xs text-slate-300 sm:grid-cols-[auto_1fr]">
            <dt>Lease</dt><dd className="font-mono">{agent.lease.id}</dd>
            <dt>Job</dt><dd className="font-mono">{agent.lease.job_id}</dd>
            <dt>Acquired</dt><dd>{timeLabel(agent.lease.acquired_at)}</dd>
            <dt>Expires</dt><dd>{timeLabel(agent.lease.expires_at)}</dd>
          </dl>
          <DemoButton className="mt-3" disabled={busy || archived || !agent.lease.current} onClick={() => testLease(agent.slot)}>
            Test stale lease on {agent.slot}
          </DemoButton>
        </> : <p className="text-sm text-slate-400">No lease recorded.</p>}
      </div>)}
    </div>
    {result && <p role="status" className="mt-3 text-sm text-cyan-100">{result}</p>}
  </details>;
}
