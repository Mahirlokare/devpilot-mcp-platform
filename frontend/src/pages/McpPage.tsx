import { useState, type FormEvent } from "react";
import { mcpApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { HealthEntry, McpServer, McpServerInput, McpTransport } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { fmtDate, fmtDuration } from "../lib/format";
import { parseArgLines, parseKeyValueLines } from "../lib/kv";
import { RiskBadge, ServerBadge } from "../components/Badge";
import { SchemaViewer } from "../components/JsonView";
import { Async, Card, EmptyState, ErrorBox, Field, Notice, PageHeader } from "../components/ui";

function ServerForm({ initial, onSaved, onCancel }: { initial?: McpServer; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? "stdio");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [args, setArgs] = useState((initial?.args ?? []).join("\n"));
  const [url, setUrl] = useState(initial?.url ?? "");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: McpServerInput = { name: name.trim(), description: description.trim(), transport };
    if (transport === "stdio") {
      if (!command.trim()) return setError("Command is required for stdio servers.");
      body.command = command.trim();
      body.args = parseArgLines(args);
    } else {
      if (!url.trim()) return setError("URL is required for streamable HTTP servers.");
      body.url = url.trim();
    }
    const envR = parseKeyValueLines(env);
    if ("error" in envR) return setError(`Environment: ${envR.error}`);
    const hdrR = parseKeyValueLines(headers);
    if ("error" in hdrR) return setError(`Headers: ${hdrR.error}`);
    if (Object.keys(envR.value).length) body.env = envR.value;
    if (Object.keys(hdrR.value).length) body.headers = hdrR.value;
    if (initial) body.enabled = enabled;
    setBusy(true);
    try {
      if (initial) await mcpApi.update(initial.id, body);
      else await mcpApi.create(body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} disabled={initial?.builtin} />
        </Field>
        <Field label="Transport">
          <select className="input" value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)}>
            <option value="stdio">stdio</option>
            <option value="streamable_http">streamable_http</option>
          </select>
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {transport === "stdio" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Command">
            <input className="input font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
          </Field>
          <Field label="Arguments" hint="One per line">
            <textarea className="input h-20 font-mono text-xs" value={args} onChange={(e) => setArgs(e.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label="URL">
          <input className="input font-mono" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Environment" hint={initial && initial.env_keys.length ? `Existing keys (values hidden): ${initial.env_keys.join(", ")}. Leave blank to keep.` : "KEY=VALUE per line"}>
          <textarea className="input h-20 font-mono text-xs" value={env} onChange={(e) => setEnv(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="HTTP headers" hint="KEY=VALUE per line; values are never shown again. Leave blank to keep.">
          <textarea className="input h-20 font-mono text-xs" value={headers} onChange={(e) => setHeaders(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      {initial && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      )}
      {error && <ErrorBox message={error} />}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy} type="submit">
          {initial ? "Save changes" : "Register server"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ServerDetails({ server }: { server: McpServer }) {
  const [tab, setTab] = useState<"tools" | "resources" | "prompts">("tools");
  const tools = useAsync(() => mcpApi.serverTools(server.id), [server.id, server.status], tab === "tools");
  const res = useAsync(() => mcpApi.serverResources(server.id), [server.id, server.status], tab === "resources");
  const prompts = useAsync(() => mcpApi.serverPrompts(server.id), [server.id, server.status], tab === "prompts");
  const active = tab === "tools" ? tools : tab === "resources" ? res : prompts;
  return (
    <div className="mt-3 space-y-2 border-t border-bg-border pt-3">
      <div className="flex gap-1">
        {(["tools", "resources", "prompts"] as const).map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <Async loading={active.loading} error={active.error} onRetry={active.reload}>
        {tab === "tools" &&
          ((tools.data ?? []).length === 0 ? (
            <EmptyState>No tools (is the server connected?).</EmptyState>
          ) : (
            <ul className="space-y-2">
              {(tools.data ?? []).map((t) => (
                <li key={t.name} className="rounded border border-bg-border bg-bg p-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-sky-300">{t.name}</span>
                    <RiskBadge risk={t.risk} />
                    {t.requires_approval && <span className="text-xs text-amber-300">requires approval</span>}
                  </div>
                  <p className="text-xs text-slate-400">{t.description}</p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-slate-400">Input schema</summary>
                    <SchemaViewer schema={t.input_schema} />
                  </details>
                </li>
              ))}
            </ul>
          ))}
        {tab === "resources" &&
          ((res.data ?? []).length === 0 ? (
            <EmptyState>No resources.</EmptyState>
          ) : (
            <ul className="space-y-1 text-sm">
              {(res.data ?? []).map((r) => (
                <li key={r.uri}>
                  <span className="font-mono text-xs text-sky-300">{r.uri}</span> — {r.name} <span className="text-xs text-slate-500">{r.mime_type}</span>
                  <p className="text-xs text-slate-400">{r.description}</p>
                </li>
              ))}
            </ul>
          ))}
        {tab === "prompts" &&
          ((prompts.data ?? []).length === 0 ? (
            <EmptyState>No prompts.</EmptyState>
          ) : (
            <ul className="space-y-1 text-sm">
              {(prompts.data ?? []).map((p) => (
                <li key={p.name}>
                  <span className="font-mono text-xs text-sky-300">{p.name}</span> <span className="text-xs text-slate-500">({p.arguments.map((a) => a.name + (a.required ? "*" : "")).join(", ")})</span>
                  <p className="text-xs text-slate-400">{p.description}</p>
                </li>
              ))}
            </ul>
          ))}
      </Async>
    </div>
  );
}

export default function McpPage() {
  const { can } = useAuth();
  const canManage = can("admin", "developer");
  const servers = useAsync(() => mcpApi.servers(), []);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthEntry[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
      servers.reload();
    }
  }

  async function runHealth() {
    setHealthBusy(true);
    setError(null);
    try {
      setHealth((await mcpApi.health()).servers);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setHealthBusy(false);
    }
  }

  const list = servers.data ?? [];
  const healthFor = (id: number) => health?.find((h) => h.id === id);

  return (
    <div>
      <PageHeader
        title="MCP Server Manager"
        subtitle="Register, connect and monitor Model Context Protocol servers."
        actions={
          <>
            <button className="btn" disabled={healthBusy} onClick={() => void runHealth()}>
              {healthBusy ? "Pinging…" : "Run health check"}
            </button>
            {canManage && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                + Register server
              </button>
            )}
          </>
        }
      />
      {!canManage && <div className="mb-3"><Notice>Your role is read-only; server management is disabled.</Notice></div>}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {editing && (
        <div className="mb-4">
          <Card title={editing === "new" ? "Register MCP server" : `Edit ${editing.name}`}>
            <ServerForm
              initial={editing === "new" ? undefined : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                servers.reload();
              }}
            />
          </Card>
        </div>
      )}
      <Async loading={servers.loading} error={servers.error} onRetry={servers.reload}>
        {list.length === 0 ? (
          <EmptyState>No MCP servers registered.</EmptyState>
        ) : (
          <>
            {list.every((s) => s.status !== "connected") && <div className="mb-3"><Notice tone="warning">No servers connected.</Notice></div>}
            <div className="space-y-3">
              {list.map((s) => {
                const h = healthFor(s.id);
                return (
                  <div key={s.id} className="card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{s.name}</span>
                          <ServerBadge status={s.status} />
                          {s.builtin && <span className="rounded bg-slate-700/60 px-1.5 text-xs text-slate-300">built-in</span>}
                          {!s.enabled && <span className="rounded bg-slate-700/60 px-1.5 text-xs text-slate-400">disabled</span>}
                        </div>
                        <p className="text-sm text-slate-400">{s.description}</p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-500">
                          {s.transport === "stdio" ? [s.command, ...s.args].filter(Boolean).join(" ") : s.url} · {s.tool_count} tools · last connected {fmtDate(s.last_connected_at)}
                        </p>
                        {s.env_keys.length > 0 && <p className="text-xs text-slate-500">env keys: {s.env_keys.join(", ")}</p>}
                        {h && (
                          <p className="text-xs text-slate-400">
                            Health: {h.status} · {h.latency_ms !== null ? fmtDuration(h.latency_ms) : "no latency"} · checked {fmtDate(h.checked_at)}
                            {h.error && <span className="text-red-300"> · {h.error}</span>}
                          </p>
                        )}
                        {s.last_error && <p className="mt-1 break-words text-sm text-red-300">Last error: {s.last_error}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {canManage &&
                          (s.status === "connected" ? (
                            <button className="btn btn-sm" disabled={busyId === s.id} onClick={() => void act(s.id, () => mcpApi.disconnect(s.id))}>
                              Disconnect
                            </button>
                          ) : (
                            <button className="btn btn-primary btn-sm" disabled={busyId === s.id || s.status === "connecting"} onClick={() => void act(s.id, () => mcpApi.connect(s.id))}>
                              {busyId === s.id ? "Working…" : "Connect"}
                            </button>
                          ))}
                        <button className="btn btn-sm" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                          {expanded === s.id ? "Hide" : "Details"}
                        </button>
                        {canManage && (
                          <button className="btn btn-sm" onClick={() => setEditing(s)}>
                            Edit
                          </button>
                        )}
                        {canManage && !s.builtin && (
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busyId === s.id}
                            onClick={() => {
                              if (window.confirm(`Delete MCP server "${s.name}"?`)) void act(s.id, () => mcpApi.remove(s.id));
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    {expanded === s.id && <ServerDetails server={s} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Async>
    </div>
  );
}
