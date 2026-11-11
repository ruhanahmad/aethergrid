import { afterEach, expect, it } from "vitest";
import { isLabHeartbeatPaused, setLabHeartbeatPaused } from "./recoveryLab";

afterEach(() => localStorage.clear());

it("honors only the legacy resource recorded as paused", () => {
  setLabHeartbeatPaused("worker", "test-id", true);
  expect(isLabHeartbeatPaused("worker", "test-id")).toBe(true);
  expect(isLabHeartbeatPaused("worker", "unrelated-id")).toBe(false);
  expect(isLabHeartbeatPaused("node", "test-id")).toBe(false);
  setLabHeartbeatPaused("worker", "test-id", false);
  expect(isLabHeartbeatPaused("worker", "test-id")).toBe(false);
});
