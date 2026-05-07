const API_BASE = (import.meta.env.VITE_API_BASE as string) || "/api";

const TOKEN_KEY = "classroom_admin_token";

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  init: RequestInit & { admin?: boolean } = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.admin) {
    const t = getAdminToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type RetrievedSource = { id: string; text: string; score: number };

export type StoredChunk = { id: string; text: string };

export type AskParams = {
  question: string;
  use_rag: boolean;
  top_k: number;
  temperature: number;
};

export type AskHandlers = {
  onSources: (sources: RetrievedSource[], useRag: boolean) => void;
  onDelta: (text: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
};

async function askStream(params: AskParams, handlers: AskHandlers) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (e: any) {
    handlers.onError(String(e.message || e));
    handlers.onDone();
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    handlers.onError(text || `${res.status} ${res.statusText}`);
    handlers.onDone();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: any;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === "sources") {
          handlers.onSources(evt.sources || [], !!evt.use_rag);
        } else if (evt.type === "delta") {
          handlers.onDelta(evt.text || "");
        } else if (evt.type === "error") {
          handlers.onError(evt.message || "Unknown error");
        }
      }
    }
  } catch (e: any) {
    handlers.onError(String(e.message || e));
  } finally {
    handlers.onDone();
  }
}

export const api = {
  login: (password: string) =>
    request<{ token: string }>("/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  listChunks: () =>
    request<{ chunks: StoredChunk[]; total: number }>("/chunks"),
  addChunks: (chunks: string[]) =>
    request<{ inserted: number; total: number }>("/admin/chunks", {
      method: "POST",
      admin: true,
      body: JSON.stringify({ chunks }),
    }),
  deleteChunk: (id: string) =>
    request<{ deleted: number; total: number }>(
      `/admin/chunks/${encodeURIComponent(id)}`,
      { method: "DELETE", admin: true }
    ),
  clearAllChunks: () =>
    request<{ deleted: number; total: number }>("/admin/chunks", {
      method: "DELETE",
      admin: true,
    }),
  askStream,
};
