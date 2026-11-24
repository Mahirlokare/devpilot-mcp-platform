import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { approvalsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { fmtDate } from "../lib/format";
import { ApprovalActions } from "../components/ApprovalActions";
import { ApprovalBadge, RiskBadge } from "../components/Badge";
import { JsonView } from "../components/JsonView";
import { ResultView } from "../components/ResultView";
import { Async, Card, EmptyState, ErrorBox, PageHeader } from "../components/ui";

type FilterMode = "pending" | "decided" | "all";

export default function ApprovalsPage() {
  const [mode, setMode] = useState<FilterMode>("pending");
  const apiStatus = mode === "pending" ? "pending" : undefined;
  const approvals = useAsync(() => approvalsApi.list(apiStatus), [apiStatus]);

  const items = useMemo(() => {
    const list = approvals.data ?? [];
    if (mode === "decided") return list.filter((a) => a.status !== "pending");
    return list;
  }, [approvals.data, mode]);

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Review and decide write or destructive tool calls before they execute."
        actions={
          <div className="flex items-center gap-2">
            {(["pending", "decided", "all"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "pending" ? "Pending" : m === "decided" ? "Decided" : "All"}
              </button>
            ))}
            <button className="btn btn-sm" onClick={approvals.reload}>
              Refresh
            </button>
          </div>
        }
      />

      <Async loading={approvals.loading} error={approvals.error} onRetry={approvals.reload}>
        {items.length === 0 ? (
          <EmptyState>
            {mode === "pending" ? "No pending approvals." : "No approvals match the selected filter."}
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <Card
                key={a.id}
                title={
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">#{a.id}</span>
                    <span className="font-mono text-sm text-sky-300">
                      {a.server_name}.{a.tool_name}
                    </span>
                    <RiskBadge risk={a.risk} />
                    <ApprovalBadge status={a.status} />
                  </div>
                }
                actions={
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {a.run_id !== null && (
                      <Link className="text-sky-300 underline" to={`/history/${a.run_id}`}>
                        Run #{a.run_id}
                      </Link>
                    )}
                    <span>Requested {fmtDate(a.created_at)}</span>
                  </div>
                }
              >
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>Requested by: {a.requested_by ?? "—"}</span>
                    {a.decided_by && <span>Decided by: {a.decided_by}</span>}
                    {a.decided_at && <span>Decided at: {fmtDate(a.decided_at)}</span>}
                    {a.comment && <span>Comment: &ldquo;{a.comment}&rdquo;</span>}
                  </div>

                  <div>
                    <p className="label">Arguments</p>
                    <JsonView value={a.arguments} maxHeight="12rem" />
                  </div>

                  {a.status === "pending" && (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="mb-2 text-xs text-amber-200">
                        Approving will immediately execute this tool call on <code>{a.server_name}</code>.
                      </p>
                      <ApprovalActions approvalId={a.id} onDecided={() => approvals.reload()} />
                    </div>
                  )}

                  {a.error && <ErrorBox message={a.error} />}

                  {a.result !== null && a.result !== undefined && (
                    <div>
                      <p className="label">Execution Result</p>
                      <ResultView data={a.result} />
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Async>
    </div>
  );
}
