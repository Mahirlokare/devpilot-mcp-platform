import { Link } from "react-router-dom";
import { analyticsApi, healthApi, runsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { fmtCost, fmtDate, fmtDuration, fmtNum } from "../lib/format";
import { Badge, RunBadge } from "../components/Badge";
import { ColumnChart } from "../components/Bars";
import { Async, Card, EmptyState, PageHeader } from "../components/ui";

function Stat({
  label,
  value,
  sub,
  to,
  accent = "teal",
}: {
  label: string;
  value: string;
  sub?: string;
  to?: string;
  accent?: "teal" | "cyan" | "amber" | "emerald";
}) {
  const accentStyles = {
    teal: "hover:border-teal-500/45 before:from-teal-400 before:to-cyan-500",
    cyan: "hover:border-cyan-500/45 before:from-cyan-400 before:to-sky-500",
    amber: "hover:border-amber-500/45 before:from-amber-400 before:to-orange-500",
    emerald: "hover:border-emerald-500/45 before:from-emerald-400 before:to-teal-500",
  }[accent];

  const inner = (
    <div
      className={`card relative overflow-hidden p-5 transition-all duration-200 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r ${accentStyles}`}
    >
      <p className="label">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block transition-transform hover:-translate-y-0.5">
      {inner}
    </Link>
  ) : (
    inner
  );
}

const QUICK_ACTIONS = [
  {
    to: "/workspace",
    badge: "AI Orchestrator",
    title: "AI Workspace",
    desc: "Natural-language task planning & deterministic multi-step MCP execution",
  },
  {
    to: "/mcp",
    badge: "7 Servers",
    title: "MCP Server Hub",
    desc: "Connect, monitor, and inspect stdio & streamable HTTP MCP servers",
  },
  {
    to: "/database",
    badge: "Read-Only AST",
    title: "Database Explorer",
    desc: "Inspect tables, run read-only SQL queries, and analyze EXPLAIN plans",
  },
  {
    to: "/analysis",
    badge: "Static Audit",
    title: "Code Intelligence",
    desc: "Repository structure, AST complexity, duplicates & security scanning",
  },
];

export default function DashboardPage() {
  const summary = useAsync(() => analyticsApi.summary(), []);
  const runs = useAsync(() => runsApi.list({ limit: 8 }), []);
  const health = useAsync(() => healthApi.get(), []);
  const s = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer Command Center"
        subtitle="Real-time governance, tool telemetry, and health across your connected Model Context Protocol ecosystem."
        actions={
          <div className="flex items-center gap-2.5">
            {health.loading ? (
              <Badge tone="muted">Checking API…</Badge>
            ) : health.error ? (
              <Badge tone="danger">API Unreachable</Badge>
            ) : (
              <Badge tone="success">System Healthy ({health.data?.status})</Badge>
            )}
            <Link to="/tools" className="btn btn-sm">
              Explore 43 Tools
            </Link>
            <Link to="/workspace" className="btn btn-primary btn-sm">
              + Launch AI Run
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="card group relative flex flex-col justify-between overflow-hidden p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-500/45 hover:shadow-glow"
          >
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <span className="rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-teal-400">
                  {q.badge}
                </span>
                <span className="text-xs text-slate-500 transition-transform group-hover:translate-x-1 group-hover:text-teal-400">
                  →
                </span>
              </div>
              <span className="block font-display text-base font-bold tracking-tight group-hover:text-teal-400">
                {q.title}
              </span>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{q.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      <Async loading={summary.loading} error={summary.error} onRetry={summary.reload}>
        {s && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat
                label="MCP Servers"
                value={`${s.servers_connected} / ${s.servers_total}`}
                sub="connected / registered"
                to="/mcp"
                accent="teal"
              />
              <Stat
                label="Tool Executions"
                value={fmtNum(s.tool_calls_total)}
                sub={`${fmtNum(s.tool_calls_failed)} failed invocations`}
                to="/usage"
                accent="cyan"
              />
              <Stat
                label="Pending Approvals"
                value={fmtNum(s.pending_approvals)}
                sub="human-in-the-loop gate"
                to="/approvals"
                accent="amber"
              />
              <Stat
                label="Orchestrator Runs"
                value={fmtNum(s.runs_total)}
                sub={`${fmtNum(s.runs_failed)} failed runs`}
                to="/history"
                accent="emerald"
              />
              <Stat
                label="Average Latency"
                value={fmtDuration(s.avg_latency_ms)}
                sub={`p95 ${fmtDuration(s.p95_latency_ms)}`}
                accent="teal"
              />
              <Stat
                label="Total Tokens"
                value={fmtNum(s.prompt_tokens + s.completion_tokens)}
                sub={`${fmtNum(s.prompt_tokens)} in / ${fmtNum(s.completion_tokens)} out`}
                accent="cyan"
              />
              <Stat
                label="Estimated AI Cost"
                value={fmtCost(s.cost_usd)}
                sub="cumulative session usage"
                accent="emerald"
              />
              <Stat
                label="Tool Success Rate"
                value={
                  s.tool_calls_total > 0
                    ? `${Math.round(((s.tool_calls_total - s.tool_calls_failed) / s.tool_calls_total) * 100)}%`
                    : "100%"
                }
                sub="verified MCP responses"
                accent="teal"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Daily Tool Executions (rose = errors)">
                {s.daily.length === 0 ? (
                  <EmptyState>No tool activity recorded yet.</EmptyState>
                ) : (
                  <ColumnChart points={s.daily.map((d) => ({ label: d.date, value: d.calls, secondary: d.errors }))} />
                )}
              </Card>
              <Card title="Recent Tool Errors">
                {s.recent_errors.length === 0 ? (
                  <EmptyState>Zero recent errors across all MCP servers.</EmptyState>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {s.recent_errors.slice(0, 6).map((e, i) => (
                      <li key={i} className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                        <p className="font-mono text-xs text-slate-400">
                          {fmtDate(e.created_at)} · {e.server_name ?? "?"}.{e.tool_name ?? "?"}
                        </p>
                        <p className="mt-0.5 break-words text-xs text-rose-200">{e.error ?? "(no message)"}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}
      </Async>

      <Card
        title="Recent AI Orchestration Runs"
        actions={
          <Link className="text-xs font-medium text-teal-400 hover:underline" to="/history">
            View all runs →
          </Link>
        }
      >
        <Async loading={runs.loading} error={runs.error} onRetry={runs.reload}>
          {(runs.data ?? []).length === 0 ? (
            <EmptyState>
              No runs yet. Start one in the{" "}
              <Link className="font-medium text-teal-400 underline" to="/workspace">
                AI Workspace
              </Link>
              .
            </EmptyState>
          ) : (
            <ul className="divide-y divide-bg-border/60">
              {(runs.data ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <Link
                    to={`/history/${r.id}`}
                    className="rounded-lg border border-teal-500/25 bg-teal-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-teal-400 hover:bg-teal-500/20"
                  >
                    #{r.id}
                  </Link>
                  <RunBadge status={r.status} />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.objective}</span>
                  <span className="rounded-md bg-bg-raised px-2 py-0.5 font-mono text-xs text-slate-400">
                    {r.step_count} steps
                  </span>
                  <span className="text-xs text-slate-500">{fmtDate(r.started_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
    </div>
  );
}
