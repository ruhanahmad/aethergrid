export function timeLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleTimeString() : "—";
}

export function statusTone(status: string | undefined | null) {
  switch (status) {
    case "COMPLETED": case "IDLE": return "healthy";
    case "RUNNING": case "BUSY": return "active";
    case "FAILED": case "OFFLINE": return "danger";
    case "QUEUED": case "SCHEDULED": case "CANCELLING": return "warning";
    default: return "neutral";
  }
}
