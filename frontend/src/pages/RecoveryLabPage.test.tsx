import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setApiKey } from "../api/authKey";
import RecoveryLabPage from "./RecoveryLabPage";

const api = vi.fn<typeof fetch>();
const node = {
  id: "lab-node",
  is_alive: true,
  is_draining: false,
  cpu_cores: 2,
  memory_mib: 2048,
  vram_mib: 0,
};

beforeEach(() => {
  vi.stubEnv("VITE_RECOVERY_LAB_ENABLED", "true");
  vi.stubGlobal("fetch", api);
  setApiKey("test-key");
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  setApiKey(null);
  api.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("blocks registration when the tenant already contains an unrelated node", async () => {
  api.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/nodes") return Response.json({ nodes: [{ ...node, id: "regular-node" }] });
    if (path === "/workers") return Response.json({ workers: [] });
    return Response.json({ jobs: [] });
  });

  render(<RecoveryLabPage />);
  const register = screen.getByRole("button", { name: "Register Test Node A" });
  await waitFor(() => expect((register as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(register);
  expect((await screen.findByRole("alert")).textContent).toContain("outside this lab session");
  expect(api.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it("shows the renewal endpoint's actual rejection for a selected lab lease", async () => {
  sessionStorage.setItem("aethergrid:recovery-lab:resources", JSON.stringify({
    nodes: { A: node.id }, workers: ["lab-worker"], jobs: ["lab-job"],
  }));
  const leaseId = "d604e89e-3025-4e1a-9ec0-180b672a44a0";
  const worker = {
    id: "lab-worker", node_id: node.id, status: "BUSY", running_job_id: "lab-job",
  };
  api.mockImplementation(async (url) => {
    switch (new URL(String(url)).pathname) {
      case "/nodes": return Response.json({ nodes: [node] });
      case "/jobs": return Response.json({ jobs: [{ id: "lab-job", status: "RUNNING" }] });
      case "/workers": return Response.json({ workers: [worker] });
      case "/workers/lab-worker":
        return Response.json({
          ...worker,
          running_job: {
            id: "lab-job",
            lease_id: leaseId,
            lease_acquired_at: new Date().toISOString(),
            lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
          },
        });
      case "/workers/lab-worker/lease/renew":
        return Response.json({ detail: "Lease not found" }, { status: 409 });
      default: throw new Error("Unexpected lab API request");
    }
  });

  render(<RecoveryLabPage />);
  await screen.findByRole("option", { name: "BUSY · lab-worker" });
  fireEvent.change(screen.getByLabelText("Lab worker"), { target: { value: "lab-worker" } });
  const testLease = screen.getByRole("button", { name: "Test Stale Lease" });
  await waitFor(() => expect((testLease as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(testLease);
  expect((await screen.findByRole("status")).textContent).toContain("HTTP 409");
  const call = api.mock.calls.find(([url]) => String(url).endsWith("/lease/renew"));
  expect(call?.[1]?.method).toBe("POST");
  expect(JSON.parse(String(call?.[1]?.body)).lease_id).not.toBe(leaseId);
});
