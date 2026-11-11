import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowUpRight, KeyRound, Maximize2, Minimize2, Play, RotateCcw, Zap } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import {
  changeRun, getRun, listRuns, reportPath, startRun, submitReport,
  type DemoAction, type DemoSession,
} from "./api";
import { ArchitectureCanvas } from "./ArchitectureCanvas";
import { BusinessScenario, type ApiTrace } from "./BusinessScenario";
import { EventTimeline } from "./EventTimeline";
import { LeaseInspector } from "./LeaseInspector";
import { DemoButton, Pill } from "./ui";
import "./demo.css";

function explain(error: unknown) {
  return error instanceof ApiError
    ? `HTTP ${error.status}${error.detail ? ` · ${error.detail}` : ""}`
    : "The backend could not be reached. Check the API connection and try again.";
}

function focusSection(id: string) {
  const element = document.getElementById(id);
  element?.scrollIntoView?.({ block: "start" });
  element?.focus({ preventScroll: true });
}

export default function DemoPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const view = useId();
  const runList = useQuery({
    queryKey: ["demo", view, "sessions"],
    queryFn: async ({ signal }) => (await listRuns(signal)).data,
    retry: false, gcTime: 0, refetchInterval: 12_000, refetchOnWindowFocus: true,
  });
  const runs = runList.data ?? [];
  const selectedId = params.get("run") || runs.find((run) => !run.archived_at)?.id || runs[0]?.id;
  const state = useQuery({
    queryKey: ["demo", view, "state", selectedId],
    queryFn: async ({ signal }) => (await getRun(selectedId!, signal)).data,
    enabled: Boolean(selectedId), retry: false, gcTime: 0,
    refetchInterval: (query) => query.state.data?.session.archived_at ? 10_000 : 2_500,
    refetchOnWindowFocus: true,
  });
  const [presented, setPresented] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [trace, setTrace] = useState<ApiTrace | null>(null);
  const [leaseEvidence, setLeaseEvidence] = useState<{ runId: string; text: string }>();
  const locked = useRef(false);
  const snapshot = state.data ? {
    ...state.data,
    events: [...state.data.events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)),
  } : null;
  const active = Boolean(snapshot && !snapshot.session.archived_at);
  const workerA = snapshot?.agents.find((agent) => agent.slot === "A");
  const job = snapshot?.job;
  const disrupted = Boolean(snapshot?.session.interrupted_at && active);
  const canDisrupt = active && !disrupted && job?.status === "RUNNING" &&
    workerA?.worker_job_id === job.id && workerA.lease?.current;
  const canRestore = active && disrupted && workerA?.node_online === false &&
    workerA.worker_status === "OFFLINE" && !workerA.lease;
  const busy = Boolean(operation);

  async function act(label: string, run: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setOperation(label);
    setNotice("");
    setFailure("");
    try {
      await run();
    } catch (error) {
      setFailure(explain(error));
    } finally {
      try {
        await queryClient.invalidateQueries({ queryKey: ["demo", view] });
      } finally {
        setOperation(null);
        locked.current = false;
      }
    }
  }

  function open(run: DemoSession) {
    setParams({ run: run.id }, { replace: true });
  }

  function begin(forceNew = false) {
    const selected = snapshot?.session ?? runs.find((run) => run.id === selectedId);
    if (!forceNew && selected && !selected.archived_at) {
      open(selected);
      setNotice("Resumed the selected server-side run.");
      focusSection("demo-architecture");
      return;
    }
    void act("Starting demo", async () => {
      const result = await startRun();
      open(result.data);
      setNotice(`HTTP ${result.status} · Demo run created with two nodes and workers.`);
    });
  }

  function submit() {
    if (!active || !selectedId || job) return;
    const path = reportPath(selectedId);
    void act("Submitting report", async () => {
      setTrace({ runId: selectedId, path });
      try {
        const result = await submitReport(selectedId);
        setTrace({ runId: selectedId, path, status: result.status, response: result.data });
        setNotice(`HTTP ${result.status} · Report accepted as ${result.data.status}.`);
      } catch (error) {
        if (error instanceof ApiError) {
          setTrace({ runId: selectedId, path, status: error.status, response: { detail: error.detail ?? error.message } });
        }
        throw error;
      }
    });
  }

  function control(action: DemoAction) {
    if (!selectedId || !active) return;
    if (action === "restart" && !window.confirm("Archive this run and start a new one? Its running report will be cancelled.")) return;
    if (action === "archive" && !window.confirm("Archive this run and cancel its active report?")) return;
    void act("Updating demo", async () => {
      const result = await changeRun(selectedId, action);
      if (action === "restart") open(result.data);
      const messages: Partial<Record<DemoAction, string>> = {
        interrupt: "Worker A's report task and both A heartbeats were interrupted. Watch the lease expire.",
        restore: "The backend accepted fresh Node A and Worker A heartbeats.",
        restart: "The previous run was archived. The new run has its own nodes and workers.",
        archive: "The run was archived. Its recorded history is still available.",
      };
      setNotice(messages[action] ?? `HTTP ${result.status}`);
    });
  }

  function testLease(slot: string) {
    if (!selectedId || !active) return;
    void act("Testing stale lease", async () => {
      setLeaseEvidence(undefined);
      try {
        const result = await changeRun(selectedId, slot === "A" ? "stale-a" : "stale-b");
        setLeaseEvidence({ runId: selectedId, text: `HTTP ${result.status} · Unexpected response from the renewal check.` });
      } catch (error) {
        if (!(error instanceof ApiError) || error.detail !== "The lease service rejected the stale lease identity.") throw error;
        setLeaseEvidence({ runId: selectedId, text: `HTTP ${error.status} · The lease service rejected the stale lease identity.` });
      }
    });
  }

  const guide = !active ? "Start a demo run to provision two isolated agents."
    : !job ? "Enter the customer dashboard and submit a daily sales report."
    : canDisrupt ? "Disrupt Worker A while it processes the report to demonstrate lease recovery."
    : canRestore ? "Node A and Worker A are offline. Restore their heartbeats to bring them back."
    : disrupted ? "Follow lease expiry, reassignment and liveness in the execution timeline."
    : "Follow the report status and inspect its recorded execution events.";

  return <div className="mx-auto max-w-[1550px] space-y-5">
    <header className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-[#102238] p-5 lg:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Pill tone={active ? "active" : "neutral"}>{active ? "Live demo run" : snapshot ? "Archived demo run" : "AetherGrid demo"}</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">From request to recovery</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">Follow a sales report through the live scheduler, interrupt its worker, and see what the backend does next.</p>
        </div>
        <DemoButton aria-pressed={presented} onClick={() => setPresented((value) => !value)}>
          {presented ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          {presented ? "Exit presentation mode" : "Presentation Mode"}
        </DemoButton>
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        {!presented && runs.length > 0 && <label className="w-full min-w-0 text-xs font-medium text-slate-300 sm:w-auto">
          Demo run
          <select value={selectedId ?? ""} disabled={busy} onChange={(event) => {
            setParams({ run: event.target.value }, { replace: true });
            setNotice("");
            setFailure("");
          }} className="mt-1 block w-full max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100">
            {selectedId && !runs.some((run) => run.id === selectedId) && <option value={selectedId}>Selected run</option>}
            {runs.map((run) => <option key={run.id} value={run.id}>
              {run.archived_at ? "Archived" : "Active"} · {new Date(run.created_at).toLocaleString()} · {run.id.slice(0, 8)}
            </option>)}
          </select>
        </label>}
        <DemoButton tone="primary" disabled={busy || runList.isPending || state.isFetching && !snapshot}
          onClick={() => begin()}><Play size={16} aria-hidden="true" /> Start Demo</DemoButton>
        {!presented && active && <DemoButton disabled={busy} onClick={() => begin(true)}>New run</DemoButton>}
        {active && <DemoButton disabled={busy} onClick={() => control("restart")}><RotateCcw size={16} aria-hidden="true" /> Restart Demo</DemoButton>}
        {!presented && active && <DemoButton disabled={busy} onClick={() => control("archive")}>Archive run</DemoButton>}
      </div>
      <div aria-live="polite" className="mt-4 text-sm">
        <p className="text-slate-200">{guide}</p>
        {operation && <p className="mt-1 text-cyan-200">{operation}…</p>}
        {notice && <p className="mt-1 text-cyan-200">{notice}</p>}
      </div>
      {(failure || state.error || runList.error) && <p role="alert" className="mt-2 text-sm text-rose-200">
        {failure || explain(state.error ?? runList.error)}
      </p>}
    </header>

    <div className={`grid items-start gap-5 ${presented ? "grid-cols-1" : "xl:grid-cols-[minmax(0,1fr)_minmax(285px,0.44fr)]"}`}>
      <div className="min-w-0 space-y-4">
        <ArchitectureCanvas snapshot={snapshot} submitting={operation === "Submitting report"} presented={presented} />
        <section aria-label="Recovery controls" className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <DemoButton disabled={!snapshot} onClick={() => focusSection("demo-architecture")}><Activity size={16} aria-hidden="true" /> Watch Execution</DemoButton>
          <DemoButton tone="danger" disabled={busy || !canDisrupt} onClick={() => control("interrupt")}><Zap size={16} aria-hidden="true" /> Disrupt Worker A</DemoButton>
          <DemoButton disabled={!snapshot} onClick={() => focusSection("demo-timeline")}><ArrowUpRight size={16} aria-hidden="true" /> Observe Recovery</DemoButton>
          <DemoButton disabled={busy || !canRestore} onClick={() => control("restore")}>Restore Worker</DemoButton>
          <DemoButton disabled={!snapshot} onClick={() => {
            const inspector = document.getElementById("demo-lease");
            if (inspector instanceof HTMLDetailsElement) inspector.open = true;
            inspector?.scrollIntoView?.({ block: "start" });
            inspector?.querySelector("summary")?.focus({ preventScroll: true });
          }}><KeyRound size={16} aria-hidden="true" /> Inspect Lease</DemoButton>
        </section>
      </div>
      <BusinessScenario snapshot={snapshot} trace={trace?.runId === selectedId ? trace : null} busy={busy} submit={submit} />
    </div>
    <LeaseInspector agents={snapshot?.agents ?? []} busy={busy} archived={!active} testLease={testLease}
      result={leaseEvidence?.runId === selectedId ? leaseEvidence?.text ?? "" : ""} />
    <EventTimeline events={snapshot?.events ?? []} />
  </div>;
}
