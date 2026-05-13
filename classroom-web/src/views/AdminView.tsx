import { useEffect, useRef, useState } from "react";
import {
  api,
  StoredChunk,
  getAdminToken,
  setAdminToken,
} from "../api";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/^﻿/, "");
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function extractChunksFromCsv(text: string): string[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const dataRows = rows.slice(1);
  return dataRows
    .map((r) => (r[1] ?? "").trim())
    .filter((c) => c.length > 0);
}

export default function AdminView() {
  const [authed, setAuthed] = useState<boolean>(!!getAdminToken());
  return authed ? (
    <AdminPanel
      onLogout={() => {
        setAdminToken(null);
        setAuthed(false);
      }}
    />
  ) : (
    <LoginForm onLoggedIn={() => setAuthed(true)} />
  );
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.login(password);
      setAdminToken(r.token);
      onLoggedIn();
    } catch {
      setError("Wrong password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto card p-6 space-y-4">
      <h2 className="text-base font-semibold">Admin login</h2>
      <p className="text-xs text-slate-500">
        The admin can add and remove chunks in the vector database.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="input"
          autoFocus
        />
        {error && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function splitChunks(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [chunks, setChunks] = useState<StoredChunk[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csvChunks, setCsvChunks] = useState<string[] | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewCount = splitChunks(draft).length;

  async function refresh() {
    try {
      const r = await api.listChunks();
      setChunks(r.chunks);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    setError(null);
    setMessage(null);
    const cleaned = splitChunks(draft);
    if (cleaned.length === 0) {
      setError("Add at least one non-empty chunk.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.addChunks(cleaned);
      setMessage(`Added ${r.inserted} chunk${r.inserted === 1 ? "" : "s"}.`);
      setDraft("");
      await refresh();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setMessage(null);
    setChunks((prev) => prev.filter((c) => c.id !== id));
    try {
      await api.deleteChunk(id);
    } catch (e: any) {
      setError(String(e.message || e));
      await refresh();
    }
  }

  async function handleCsvFile(file: File) {
    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      const extracted = extractChunksFromCsv(text);
      setCsvChunks(extracted);
      setCsvFileName(file.name);
      if (extracted.length === 0) {
        setError("No non-empty chunks found in the second column of the CSV.");
      }
    } catch (e: any) {
      setError(`Could not read CSV: ${String(e.message || e)}`);
      setCsvChunks(null);
      setCsvFileName(null);
    }
  }

  function clearCsv() {
    setCsvChunks(null);
    setCsvFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function ingestCsv() {
    if (!csvChunks || csvChunks.length === 0) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const r = await api.addChunks(csvChunks);
      setMessage(
        `Ingested ${r.inserted} chunk${r.inserted === 1 ? "" : "s"} from ${
          csvFileName ?? "CSV"
        }.`
      );
      clearCsv();
      await refresh();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    if (!confirm("Delete ALL chunks from the database? This cannot be undone.")) {
      return;
    }
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const r = await api.clearAllChunks();
      setMessage(
        `Database cleared. Removed ${r.deleted} chunk${r.deleted === 1 ? "" : "s"}.`
      );
      await refresh();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Upload chunks from CSV</h2>
            <button onClick={onLogout} className="btn-secondary text-xs">
              Log out
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Upload a CSV where each row is one chunk and the{" "}
            <strong>second column</strong> contains the chunk text. The first
            row is treated as a header. Empty cells are skipped.
          </p>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCsvFile(f);
              }}
              className="block text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
            />
            {csvFileName && (
              <button
                onClick={clearCsv}
                className="btn-secondary text-xs"
                disabled={busy}
              >
                Clear
              </button>
            )}
          </div>

          {csvChunks && csvChunks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Preview: {csvChunks.length} chunk
                  {csvChunks.length === 1 ? "" : "s"} from{" "}
                  <span className="font-mono">{csvFileName}</span>
                </span>
                <button
                  onClick={ingestCsv}
                  disabled={busy}
                  className="btn-primary"
                >
                  {busy ? "Ingesting…" : `Ingest ${csvChunks.length} chunk${
                    csvChunks.length === 1 ? "" : "s"
                  }`}
                </button>
              </div>
              <ol className="max-h-64 overflow-auto rounded-md border border-slate-200 divide-y divide-slate-200 text-xs">
                {csvChunks.map((c, idx) => (
                  <li key={idx} className="p-2 flex gap-2">
                    <span className="font-mono text-slate-400 shrink-0">
                      {idx + 1}.
                    </span>
                    <span className="whitespace-pre-wrap text-slate-700">
                      {c}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Add chunks</h2>
          </div>
          <p className="text-xs text-slate-500">
            Paste your chunks below. Separate each chunk with a{" "}
            <strong>line break</strong> (press Enter). Blank lines work too.
          </p>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder={
              "Chunk one goes here.\nChunk two on the next line.\n\nChunk three after a blank line."
            }
            className="input resize-y font-mono text-xs leading-relaxed"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {previewCount} chunk{previewCount === 1 ? "" : "s"} detected
            </span>
            <button onClick={add} disabled={busy || previewCount === 0} className="btn-primary">
              {busy ? "Adding…" : `Add ${previewCount || ""} to vector DB`.trim()}
            </button>
          </div>

          {message && (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Stored chunks</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {chunks.length} total
              </span>
              <button
                onClick={resetAll}
                disabled={busy || chunks.length === 0}
                className="btn-danger text-xs"
                title="Delete all chunks"
              >
                Reset
              </button>
            </div>
          </div>
          {chunks.length === 0 && (
            <p className="text-xs text-slate-500">
              The database is empty. Add chunks on the left.
            </p>
          )}
          <ul className="space-y-2">
            {chunks.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-slate-200 p-2 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-indigo-700">
                    [{c.id}]
                  </span>
                  <button
                    onClick={() => remove(c.id)}
                    className="btn-danger text-xs"
                  >
                    Delete
                  </button>
                </div>
                <p
                  className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-2 hover:line-clamp-none transition-all cursor-default"
                  title={c.text}
                >
                  {c.text}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
