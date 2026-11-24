import { useState } from "react";
import { analyticsApi, auditApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { fmtCost, fmtDate, fmtDuration, fmtNum, toPrettyJson } from "../lib/format";
import { Bars, ColumnChart } from "../components/Bars";
import { Async, Card, EmptyState, Field, PageHeader } from "../components/ui";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function UsagePage() {
  const summary = useAsync(() => analyticsApi.summary(), []);
  const [eventType, setEventType] = useState("");
  const [limit, setLimit] = useState(50);
  const audit = useAsync(
    () => auditApi.list({ limit, event_type: eventType.trim() || undefined }),
    [limit, eventType],
  );

  const s = summary.data;

  return (
    <div>
      <PageHeader
        title="Usage & Analytics"
        subtitle="Track MCP tool latency, error rates, LLM token usage, costs, and the immutable audit log."
        actions={
          <button
            className="btn"
            onClick={() => {
              summary.reload();
              audit.reload();
            }}
          >
            Refresh
          </button>
        }
      />

      <Async loading={summary.loading} error={summary.error} onRetry={summary.reload}>
        {s && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Connected Servers"
                value={`${s.servers_connected} / ${s.servers_total}`}
                sub="active MCP connections"
              />
              <StatCard
                label="Tool Calls"
                value={fmtNum(s.tool_calls_total)}
                sub={`${fmtNum(s.tool_calls_failed)} failed`}
              />
              <StatCard
                label="Latency"
                value={fmtDuration(s.avg_latency_ms)}
                sub={`p95 ${fmtDuration(s.p95_latency_ms)}`}
              />
              <StatCard
                label="Pending Approvals"
                value={fmtNum(s.pending_approvals)}
                sub="awaiting decision"
              />
              <StatCard
                label="Agent Runs"
                value={fmtNum(s.runs_total)}
                sub={`${fmtNum(s.runs_failed)} failed`}
              />
              <StatCard
                label="Prompt Tokens"
                value={fmtNum(s.prompt_tokens)}
                sub={`${fmtNum(s.completion_tokens)} completion`}
              />
              <StatCard
                label="Total Tokens"
                value={fmtNum(s.prompt_tokens + s.completion_tokens)}
              />
              <StatCard label="Total Cost" value={fmtCost(s.cost_usd)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Tool Calls by Server (red = errors)">
                {s.tools_by_server.length === 0 ? (
                  <EmptyState>No tool calls recorded yet.</EmptyState>
                ) : (
                  <div className="space-y-3">
                    <Bars
                      items={s.tools_by_server.map((t) => ({
                        label: t.server,
                        value: t.calls,
                        secondary: t.errors,
                      }))}
                    />
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="th">Server</th>
                            <th className="th">Calls</th>
                            <th className="th">Errors</th>
                            <th className="th">Avg Latency</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.tools_by_server.map((t) => (
                            <tr key={t.server}>
                              <td className="td font-mono text-xs text-sky-300">{t.server}</td>
                              <td className="td font-mono text-xs">{fmtNum(t.calls)}</td>
                              <td className="td font-mono text-xs text-red-300">{fmtNum(t.errors)}</td>
                              <td className="td font-mono text-xs">{fmtDuration(t.avg_ms)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>

              <Card title="Recent Errors">
                {s.recent_errors.length === 0 ? (
                  <EmptyState>No recent tool errors.</EmptyState>
                ) : (
                  <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                    {s.recent_errors.map((e, i) => (
                      <li key={i} className="rounded border border-red-500/30 bg-red-500/5 p-2">
                        <p className="font-mono text-xs text-slate-400">
                          {fmtDate(e.created_at)} · {e.server_name ?? "?"}.{e.tool_name ?? "?"}
                        </p>
                        <p className="break-words text-xs text-red-200">{e.error ?? "(no message)"}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Daily Tool Calls (red = errors)">
                {s.daily.length === 0 ? (
                  <EmptyState>No daily call data.</EmptyState>
                ) : (
                  <ColumnChart
                    points={s.daily.map((d) => ({
                      label: d.date,
                      value: d.calls,
                      secondary: d.errors,
                    }))}
                  />
                )}
              </Card>
              <Card title="Daily Tokens">
                {s.daily.length === 0 ? (
                  <EmptyState>No daily token data.</EmptyState>
                ) : (
                  <Bars
                    items={s.daily.map((d) => ({
                      label: d.date,
                      value: d.tokens,
                    }))}
                  />
                )}
              </Card>
              <Card title="Daily Cost (USD)">
                {s.daily.length === 0 ? (
                  <EmptyState>No daily cost data.</EmptyState>
                ) : (
                  <Bars
                    items={s.daily.map((d) => ({
                      label: d.date,
                      value: d.cost_usd,
                    }))}
                    format={(n) => fmtCost(n)}
                  />
                )}
              </Card>
            </div>
          </div>
        )}
      </Async>

      <div className="mt-4">
        <Card
          title="Audit Log"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input w-44 text-xs"
                placeholder="Filter event_type…"
                aria-label="Filter event_type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
              />
              <Field label="">
                <select
                  className="input w-24 text-xs"
                  aria-label="Audit limit"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </Field>
            </div>
          }
        >
          <Async loading={audit.loading} error={audit.error} onRetry={audit.reload}>
            {(audit.data ?? []).length === 0 ? (
              <EmptyState>No audit events recorded.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th">Time</th>
                      <th className="th">Actor</th>
                      <th className="th">Event</th>
                      <th className="th">Target</th>
                      <th className="th">Outcome</th>
                      <th className="th">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(audit.data ?? []).map((ev) => (
                      <tr key={ev.id}>
                        <td className="td whitespace-nowrap text-xs text-slate-400">{fmtDate(ev.created_at)}</td>
                        <td className="td font-mono text-xs">{ev.actor ?? "—"}</td>
                        <td className="td font-mono text-xs text-sky-300">{ev.event_type}</td>
                        <td className="td font-mono text-xs">
                          {ev.server_name || ev.tool_name
                            ? `${ev.server_name ?? ""}.${ev.tool_name ?? ""}`
                            : "—"}
                        </td>
                        <td className="td font-mono text-xs">{ev.outcome ?? "—"}</td>
                        <td className="td max-w-md truncate font-mono text-xs text-slate-400">
                          {ev.detail ? toPrettyJson(ev.detail) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Async>
        </Card>
      </div>
    </div>
  );
}
