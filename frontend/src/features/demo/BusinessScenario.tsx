import { ClipboardList, FileSpreadsheet, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { DemoJob, DemoSnapshot } from "./api";
import { statusTone } from "./format";
import { DemoButton, Pill } from "./ui";

export interface ApiTrace {
  runId: string;
  path: string;
  status?: number;
  response?: DemoJob | { detail: string };
}

function ApiInspector({ trace }: { trace: ApiTrace | null }) {
  return <details className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/60 p-3">
    <summary className="cursor-pointer text-sm font-semibold text-cyan-100">API request and response</summary>
    {trace ? <div className="mt-3 space-y-2 text-xs text-slate-300">
      <p className="break-all font-mono">POST {trace.path}</p>
      <p>{trace.status === undefined ? "Waiting for HTTP response" : `HTTP ${trace.status}`}</p>
      {trace.response && <pre className="max-h-56 overflow-auto rounded bg-slate-950 p-2">{JSON.stringify(trace.response, null, 2)}</pre>}
    </div> : <p className="mt-3 text-xs text-slate-400">Submit a report in this tab to inspect the HTTP exchange. The timeline retains backend activity across tabs.</p>}
  </details>;
}

export function BusinessScenario({ snapshot, trace, busy, submit }: {
  snapshot: DemoSnapshot | null;
  trace: ApiTrace | null;
  busy: boolean;
  submit: () => void;
}) {
  const [signedIn, setSignedIn] = useState(false);
  const job = snapshot?.job;
  const report = snapshot?.events.find((event) => event.type === "DemoReportGenerated");
  const total = report ? Number(report.details.total_cents) / 100 : null;
  const totalLabel = total !== null && Number.isFinite(total)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)
    : null;
  return <section aria-labelledby="demo-business-title" className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
    <div className="flex items-center gap-3">
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-2.5 text-cyan-200"><ClipboardList size={22} aria-hidden="true" /></div>
      <div>
        <h2 id="demo-business-title" className="text-lg font-semibold text-white">Commerce operations</h2>
        <p className="text-xs text-slate-400">Illustrative customer portal</p>
      </div>
    </div>
    {signedIn || job ? <div className="mt-5 rounded-xl border border-slate-700/70 bg-slate-950/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-white">Daily sales report</h3>
        {job && <Pill tone={statusTone(job.status)}>{job.status}</Pill>}
      </div>
      <p className="mt-2 text-sm text-slate-400">Aggregate 800 synthetic orders into a single revenue total.</p>
      {totalLabel && <div className="mt-3 text-2xl font-semibold text-emerald-200">{totalLabel} <span className="text-xs text-slate-400">gross sales</span></div>}
      {!snapshot && <p className="mt-2 text-xs text-slate-400">Start a demo run to enable submission.</p>}
      <DemoButton className="mt-4" tone="primary" disabled={busy || !snapshot || Boolean(snapshot.session.archived_at) || Boolean(job)} onClick={submit}>
        <FileSpreadsheet size={16} aria-hidden="true" /> Submit Business Task
      </DemoButton>
    </div> : <form className="mt-5 space-y-3" onSubmit={(event) => {
      event.preventDefault();
      setSignedIn(true);
    }}>
      <label className="block text-sm text-slate-300">
        Demo account
        <input className="mt-1.5 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-300"
          value="Commerce Operations Analyst" readOnly />
      </label>
      <p className="text-xs text-slate-400">This illustrative sign-in uses no credentials. Your existing AetherGrid sign-in authorizes the report.</p>
      <DemoButton type="submit"><LockKeyhole size={15} aria-hidden="true" /> Enter customer dashboard</DemoButton>
    </form>}
    <ApiInspector trace={trace} />
  </section>;
}
