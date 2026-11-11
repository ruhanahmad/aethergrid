// Honor pauses left by the previous Recovery Lab for the ordinary dashboard.
// Server-owned demo agents never use browser heartbeat state.
type HeartbeatTarget = "node" | "worker";

function pauseKey(kind: HeartbeatTarget, id: string) {
  return `aethergrid:recovery-lab:paused:${kind}:${id}`;
}

export function isLabHeartbeatPaused(kind: HeartbeatTarget, id: string) {
  return localStorage.getItem(pauseKey(kind, id)) === "true";
}

export function setLabHeartbeatPaused(kind: HeartbeatTarget, id: string, paused: boolean) {
  const key = pauseKey(kind, id);
  if (paused) {
    localStorage.setItem(key, "true");
  } else {
    localStorage.removeItem(key);
  }
}
