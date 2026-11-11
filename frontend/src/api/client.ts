import { getApiKey, setApiKey } from "./authKey";

const API_BASE =
  import.meta.env.VITE_API_URL ??
  "http://localhost:8000";

export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, detail?: string) {
    super(`API Error ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export async function apiWithStatus<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const response = await fetch(
    `${API_BASE}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey() ?? ""}`,
        ...(init?.headers ?? {}),
      },
    },
  );
  if (!response.ok) {
    if (response.status === 401) {
      // Key was present but the server rejected it (rotated, revoked,
      // expired). Clear it so AuthGate falls back to the login form
      // instead of leaving the user stranded on a bare error screen.
      setApiKey(null);
    }
    const body: { detail?: unknown } | null = await response.json().catch(() => null);
    throw new ApiError(response.status, typeof body?.detail === "string" ? body.detail : undefined);
  }
  if (response.status === 204) {
    return { status: response.status, data: undefined as T };
  }
  return { status: response.status, data: await response.json() };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiWithStatus<T>(path, init)).data;
}
