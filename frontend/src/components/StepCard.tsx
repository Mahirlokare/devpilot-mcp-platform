import { useState } from "react";
import type { Step } from "../api/types";
import { fmtDuration } from "../lib/format";
import { StepBadge } from "./Badge";
import { ApprovalActions } from "./ApprovalActions";
import { JsonView } from "./JsonView";
import { ResultView } from "./ResultView";
import { ErrorBox } from "./ui";

export function StepCard({ step, onDecided }: { step: Step; onDecided: () => void }) {
  const [showResult, setShowResult] = useState(step.status === "failed" || step.status === "denied");
  const hasArgs = step.arguments !== null && step.arguments !== undefined && !(typeof step.arguments === "object" && Object.keys(step.arguments as object).length === 0);

  return (
    <li className="rounded-md border border-bg-border bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs text-slate-500">#{step.index}</span>
        <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-xs text-slate-300">{step.kind}</span>
        {step.kind === "tool_call" ? (
          <>
            <span className="text-xs text-slate-400">server</span>
            <span className="font-mono text-xs text-sky-300">{step.server_name ?? "—"}</span>
            <span className="text-xs text-slate-400">tool</span>
            <span className="font-mono text-xs text-sky-300">{step.tool_name ?? "—"}</span>
          </>
        ) : (
          step.tool_name && <span className="font-mono text-xs text-sky-300">{step.tool_name}</span>
        )}
        <StepBadge status={step.status} />
        <span className="ml-auto text-xs text-slate-400">{fmtDuration(step.duration_ms)}</span>
      </div>

      {hasArgs && (
        <div className="mt-2">
          <p className="label">Arguments</p>
          <JsonView value={step.arguments} maxHeight="10rem" />
        </div>
      )}

      {step.status === "awaiting_approval" && step.approval_id !== null && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2">
          <p className="mb-2 text-xs text-amber-200">Approval #{step.approval_id} required before this tool runs.</p>
          <ApprovalActions approvalId={step.approval_id} onDecided={onDecided} />
        </div>
      )}

      {step.error && (
        <div className="mt-2">
          <ErrorBox message={step.error} />
        </div>
      )}

      {step.result !== null && step.result !== undefined && (
        <div className="mt-2">
          <button className="btn btn-sm" onClick={() => setShowResult((s) => !s)}>
            {showResult ? "Hide result" : "Show result"}
          </button>
          {showResult && (
            <div className="mt-2">
              <ResultView data={step.result} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
