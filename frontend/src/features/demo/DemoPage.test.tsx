import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setApiKey } from "../../api/authKey";
import type { DemoAgent, DemoJob, DemoSession, DemoSnapshot } from "./api";
import DemoPage from "./DemoPage";

const fetchApi = vi.fn<typeof fetch>();
const sessions = "/demo/sessions";
const first = { id: "server-run-a", created_at: "2026-01-02T09:00:00Z", archived_at: null, interrupted_at: null };
const second = { ...first, id: "server-run-b", created_at: "2026-01-02T10:00:00Z" };
const job: DemoJob = {
  id: "report-job", status: "RUNNING", assigned_node_id: "node-a", retry_count: 0,
  max_retries: 2, cpu_cores: 1, memory_mib: 128, exit_code: null,
};
const agent: DemoAgent = {
  slot: "A", node_id: "node-a", node_online: true, node_last_seen_at: first.created_at,
  worker_id: "worker-a", worker_status: "BUSY", worker_last_seen_at: first.created_at,
  worker_job_id: job.id, cpu_cores: 2, memory_mib: 1024,
  lease: { id: "actual-lease", job_id: job.id, acquired_at: first.created_at, expires_at: second.created_at, current: true },
};

function renderDemo(path = "/demo") {
  const query = new QueryClient();
  return render(<QueryClientProvider client={query}>
    <MemoryRouter initialEntries={[path]}><DemoPage /></MemoryRouter>
  </QueryClientProvider>);
}

function state(session: DemoSession, report: DemoJob | null = null): DemoSnapshot {
  return { session, job: report, agents: report ? [agent] : [], events: [] };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchApi);
  setApiKey("test-existing-key");
});

afterEach(() => {
  cleanup();
  setApiKey(null);
  vi.unstubAllGlobals();
  fetchApi.mockReset();
});

it("restores runs from the backend and keeps a selected run across reopen", async () => {
  fetchApi.mockImplementation(async (input, request) => {
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer test-existing-key");
    const path = new URL(String(input)).pathname;
    if (path === sessions) return Response.json([second, first]);
    if (path === `${sessions}/${first.id}`) return Response.json(state(first, job));
    if (path === `${sessions}/${second.id}`) return Response.json(state(second));
    throw new Error("Unexpected demo API request");
  });
  const tab = renderDemo();
  const picker = await screen.findByRole("combobox", { name: "Demo run" });
  expect((picker as HTMLSelectElement).value).toBe(second.id);
  fireEvent.change(picker, { target: { value: first.id } });
  await screen.findByRole("heading", { name: "Worker A" });
  tab.unmount();

  renderDemo(`/demo?run=${first.id}`);
  await screen.findByRole("heading", { name: "Worker A" });
  expect((screen.getByRole("combobox", { name: "Demo run" }) as HTMLSelectElement).value).toBe(first.id);
  expect(fetchApi.mock.calls.every(([, request]) => request?.method !== "POST")).toBe(true);
  expect(document.body.textContent).not.toContain("test-existing-key");
});

it("submits the real report, displays API status and follows recorded recovery events", async () => {
  let snapshot = state(first);
  fetchApi.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === sessions) return Response.json([first]);
    if (path === `${sessions}/${first.id}`) return Response.json(snapshot);
    if (path.endsWith("/report")) {
      snapshot = state(first, job);
      return Response.json({ ...job, status: "QUEUED" }, { status: 201 });
    }
    if (path.endsWith("/stale-a")) {
      return Response.json({ detail: "The lease service rejected the stale lease identity." }, { status: 409 });
    }
    if (path.endsWith("/interrupt")) {
      snapshot = {
        ...snapshot, session: { ...first, interrupted_at: second.created_at },
        events: [{
          id: "reclaim-event", resource_id: job.id, type: "JobReclaimed",
          occurred_at: second.created_at, details: {},
        }],
      };
      return Response.json(snapshot.session);
    }
    throw new Error("Unexpected demo API request");
  });
  renderDemo();
  fireEvent.click(screen.getByRole("button", { name: "Enter customer dashboard" }));
  const submit = screen.getByRole("button", { name: "Submit Business Task" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  await screen.findByText("HTTP 201 · Report accepted as QUEUED.");
  fireEvent.click(screen.getByRole("button", { name: "Inspect Lease" }));
  const stale = await screen.findByRole("button", { name: "Test stale lease on A" });
  await waitFor(() => expect((stale as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(stale);
  await screen.findByText("HTTP 409 · The lease service rejected the stale lease identity.");
  expect(screen.queryByText("JobReclaimed")).toBeNull();
  const disrupt = screen.getByRole("button", { name: "Disrupt Worker A" });
  await waitFor(() => expect((disrupt as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(disrupt);
  await screen.findByText("JobReclaimed");
  expect(screen.queryByText("JobCompleted")).toBeNull();
  const posts = fetchApi.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(posts.map(([input]) => new URL(String(input)).pathname)).toEqual([
    `${sessions}/${first.id}/report`, `${sessions}/${first.id}/stale-a`, `${sessions}/${first.id}/interrupt`,
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Presentation Mode" }));
  expect(screen.queryByRole("combobox", { name: "Demo run" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Live execution path" })).toBeTruthy();
});
