import { Link } from "react-router-dom";
import type { ToolCallState } from "../hooks/useToolCall";
import { fmtDuration } from "../lib/format";
import { ApprovalBadge, StepBadge } from "./Badge";
import { ApprovalActions } from "./ApprovalActions";
import { ResultView } from "./ResultView";
import { ErrorBox, Loading, Notice } from "./ui";

/** Displays the outcome of a manual tool call, including the approval lifecycle. Never shows success unless the API did. */
export function ToolCallPanel({ state, onRefresh }: { state: ToolCallState; onRefresh: () => void }) {
  const { running, requestError, result, approval } = state;
  if (running) return <Loading label="Calling tool…" />;
  if (requestError && !result) return <ErrorBox message={requestError} />;
  if (!result) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StepBadge status={result.status} />
        <span className="text-slate-400">{fmtDuration(result.duration_ms)}</span>
      </div>
      {requestError && <ErrorBox message={requestError} />}

      {result.status === "succeeded" && <ResultView data={result.result} />}

      {(result.status === "failed" || result.status === "denied") && (
        <>
          <ErrorBox message={result.error || (result.status === "denied" ? "Denied." : "Tool call failed.")} />
          {result.result != null && <ResultView data={result.result} />}
        </>
      )}

      {result.status === "awaiting_approval" && (
        <div className="space-y-3">
          <Notice tone="warning">
            Awaiting approval — nothing has been executed yet.{" "}
            {result.approval_id !== null && (
              <>
                Approval #{result.approval_id} (<Link className="underline" to="/approvals">open Approvals</Link>).
              </>
            )}
          </Notice>
          {approval && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Approval status: <ApprovalBadge status={approval.status} />
              {approval.decided_by && <span className="text-slate-400">by {approval.decided_by}</span>}
              {approval.comment && <span className="text-slate-400">“{approval.comment}”</span>}
              <button className="btn btn-sm" onClick={onRefresh}>
                Refresh
              </button>
            </div>
          )}
          {result.approval_id !== null && (!approval || approval.status === "pending") && (
            <ApprovalActions approvalId={result.approval_id} onDecided={onRefresh} />
          )}
          {approval?.status === "approved" && <Notice>Approved; waiting for the API to report execution…</Notice>}
          {approval?.status === "executed" && (
            <div className="space-y-2">
              <p className="text-sm text-emerald-300">Executed after approval.</p>
              <ResultView data={approval.result} />
            </div>
          )}
          {approval?.status === "failed" && <ErrorBox message={approval.error || "Execution failed after approval."} />}
          {approval?.status === "denied" && <ErrorBox message={`Denied${approval.comment ? `: ${approval.comment}` : "."}`} />}
          {approval?.status === "expired" && <ErrorBox message="Approval expired; nothing was executed." />}
        </div>
      )}
    </div>
  );
}
