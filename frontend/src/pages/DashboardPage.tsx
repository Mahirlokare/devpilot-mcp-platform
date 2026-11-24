import { Link } from "react-router-dom";
import { analyticsApi, healthApi, runsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { fmtCost, fmtDate, fmtDuration, fmtNum } from "../lib/format";
import { RunBadge } from "../components/Badge";
import { ColumnChart } from "../components/Bars";
import { Async, Card, EmptyState, PageHeader } from "../components/ui";

function Stat({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) {
  const inner = (
    <div className="card p-4 hover:border-slate-500">
      <p className="label">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export default function DashboardPage() {
  const summary = useAsync(() => analyticsApi.summary(), []);
  const runs = useAsync(() => runsApi.list({ limit: 8 }), []);
  const health = useAsync(() => healthApi.get(), []);
  const s = summary.data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview from the DevPilot API."
        actions={
          <span className="text-xs text-slate-400">
            API health: {health.loading ? "checking…" : health.error ? <span className="text-red-300">unreachable</span> : <span className="text-emerald-300">{health.data?.status}</span>}
          </span>
        }
      />
      <Async loading={summary.loading} error={summary.error} onRetry={summary.reload}>
        {s && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="MCP servers" value={`${s.servers_connected} / ${s.servers_total}`} sub="connected / registered" to="/mcp" />
              <Stat label="Tool calls" value={fmtNum(s.tool_calls_total)} sub={`${fmtNum(s.tool_calls_failed)} failed`} to="/usage" />
              <Stat label="Pending approvals" value={fmtNum(s.pending_approvals)} to="/approvals" />
              <Stat label="Agent runs" value={fmtNum(s.runs_total)} sub={`${fmtNum(s.runs_failed)} failed`} to="/history" />
              <Stat label="Avg latency" value={fmtDuration(s.avg_latency_ms)} sub={`p95 ${fmtDuration(s.p95_latency_ms)}`} />
              <Stat label="Tokens" value={fmtNum(s.prompt_tokens + s.completion_tokens)} sub={`${fmtNum(s.prompt_tokens)} in / ${fmtNum(s.completion_tokens)} out`} />
              <Stat label="Cost" value={fmtCost(s.cost_usd)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Tool calls per day (red = errors)">
                {s.daily.length === 0 ? <EmptyState>No tool activity recorded yet.</EmptyState> : <ColumnChart points={s.daily.map((d) => ({ label: d.date, value: d.calls, secondary: d.errors }))} />}
              </Card>
              <Card title="Recent errors">
                {s.recent_errors.length === 0 ? (
                  <EmptyState>No recent errors.</EmptyState>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {s.recent_errors.slice(0, 6).map((e, i) => (
                      <li key={i} className="rounded border border-red-500/30 bg-red-500/5 p-2">
                        <p className="font-mono text-xs text-slate-400">
                          {fmtDate(e.created_at)} · {e.server_name ?? "?"}.{e.tool_name ?? "?"}
                        </p>
                        <p className="break-words text-red-200">{e.error ?? "(no message)"}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}
      </Async>
      <div className="mt-4">
        <Card title="Recent runs" actions={<Link className="text-xs text-sky-300 underline" to="/history">All runs</Link>}>
          <Async loading={runs.loading} error={runs.error} onRetry={runs.reload}>
            {(runs.data ?? []).length === 0 ? (
              <EmptyState>
                No runs yet. Start one in the <Link className="underline" to="/workspace">AI Workspace</Link>.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-bg-border">
                {(runs.data ?? []).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link to={`/history/${r.id}`} className="font-mono text-xs text-sky-300 underline">#{r.id}</Link>
                    <RunBadge status={r.status} />
                    <span className="min-w-0 flex-1 truncate">{r.objective}</span>
                    <span className="text-xs text-slate-500">{fmtDate(r.started_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Card>
      </div>
    </div>
  );
}
