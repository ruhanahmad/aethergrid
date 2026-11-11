import { afterEach, describe, expect, it } from "vitest";
import {
  canCancelLabJob, incorrectLeaseId, isLabHeartbeatPaused, isTerminalLabJob,
  labJobRequest, setLabHeartbeatPaused,
} from "./recoveryLab";

afterEach(() => localStorage.clear());

describe("Recovery Lab controls", () => {
  it("pauses only the recorded resource and clears the pause on resume", () => {
    setLabHeartbeatPaused("worker", "test-id", true);
    expect(isLabHeartbeatPaused("worker", "test-id")).toBe(true);
    expect(isLabHeartbeatPaused("worker", "unrelated-id")).toBe(false);
    expect(isLabHeartbeatPaused("node", "test-id")).toBe(false);
    setLabHeartbeatPaused("worker", "test-id", false);
    expect(isLabHeartbeatPaused("worker", "test-id")).toBe(false);
  });

  it("requests more CPU than any available node advertised and supplies no command", () => {
    expect(labJobRequest("oversized", 8)).toEqual({
      cpu_cores: 9, memory_mib: 128, vram_mib: 0,
    });
  });

  it("uses distinct commands for the three job scenarios", () => {
    const commands = (["success", "failure", "slow"] as const)
      .map((kind) => labJobRequest(kind, 2).command?.join(" "));
    expect(new Set(commands).size).toBe(3);
    expect(commands).toEqual(expect.arrayContaining([
      expect.stringContaining("SystemExit(1)"),
      expect.stringContaining("sleep(120)"),
    ]));
  });

  it("does not cancel settled jobs or treat pending cancellations as settled", () => {
    expect(canCancelLabJob("RUNNING")).toBe(true);
    expect(canCancelLabJob("COMPLETED")).toBe(false);
    expect(canCancelLabJob("CANCELLING")).toBe(false);
    expect(isTerminalLabJob("CANCELLING")).toBe(false);
    expect(isTerminalLabJob("CANCELLED")).toBe(true);
  });

  it("uses a different UUID even if the current lease matches the first candidate", () => {
    const first = incorrectLeaseId("8579ff2e-4608-4535-b20f-9d0efc0acb52");
    expect(first).toMatch(/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
    expect(incorrectLeaseId(first)).not.toBe(first);
  });
});
