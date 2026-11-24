import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { runsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { fmtCost, fmtDate, fmtDuration, fmtNum } from "../lib/format";
import { RunBadge } from "../components/Badge";
import { RunPanel } from "../components/RunPanel";
import { Async, Card, EmptyState, Field, PageHeader } from "../components/ui";

const STATUSES = ["", "pending", "running", "awaiting_approval", "completed", "failed", "cancelled"] as const;

export default function HistoryPage() {
  const { runId } = useParams<{ runId?: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);

  const runs = useAsync(
    () => runsApi.list({ limit, status: status || undefined }),
    [limit, status],
  );

  const selectedId = runId ? Number(runId) : null;

  return (
    <div>
      <PageHeader
        title="Execution History"
        subtitle="Inspect past and active AI workspace runs, step-by-step tool calls, token usage, and costs."
        actions={
          <button className="btn" onClick={runs.reload}>
            Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="Status filter">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "All statuses" : s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-32">
          <Field label="Limit">
            <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <Card title={`Runs (${(runs.data ?? []).length})`}>
          <Async loading={runs.loading} error={runs.error} onRetry={runs.reload}>
            {(runs.data ?? []).length === 0 ? (
              <EmptyState>
                No runs match. Start a run in the{" "}
                <Link className="underline" to="/workspace">
                  AI Workspace
                </Link>
                .
              </EmptyState>
            ) : (
              <ul className="max-h-[38rem] space-y-1.5 overflow-y-auto">
                {(runs.data ?? []).map((r) => {
                  const active = selectedId === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/history/${r.id}`)}
                        className={`w-full rounded border px-3 py-2 text-left transition ${
                          active
                            ? "border-sky-500/60 bg-sky-500/15"
                            : "border-bg-border bg-bg hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-sky-300">#{r.id}</span>
                          <RunBadge status={r.status} />
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm">{r.objective || "—"}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {r.step_count} steps · {fmtDuration(r.duration_ms)} · {fmtCost(r.cost_usd)} ·{" "}
                          {fmtNum(r.prompt_tokens + r.completion_tokens)} tok
                        </p>
                        <p className="text-[11px] text-slate-500">{fmtDate(r.started_at)}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Async>
        </Card>

        <div className="min-w-0">
          {selectedId && !Number.isNaN(selectedId) ? (
            <RunPanel key={selectedId} runId={selectedId} onSettled={() => runs.reload()} defaultOpen />
          ) : (
            <EmptyState>Select a run on the left to inspect its steps, tool outputs, and summary.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
