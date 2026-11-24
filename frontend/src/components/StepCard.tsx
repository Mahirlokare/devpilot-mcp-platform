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
  const hasArgs =
    step.arguments !== null &&
    step.arguments !== undefined &&
    !(typeof step.arguments === "object" && Object.keys(step.arguments as object).length === 0);

  return (
    <li className="rounded-xl border border-bg-border/80 bg-bg/70 p-4 transition hover:border-teal-500/30">
      <div className="flex flex-wrap items-center gap-2.5 text-sm">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-bg-raised font-mono text-xs font-semibold text-slate-400">
          {step.index}
        </span>
        <span className="rounded-md bg-bg-raised px-2 py-0.5 font-mono text-[11px] font-medium text-slate-300">
          {step.kind}
        </span>
        {step.kind === "tool_call" ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-teal-500/25 bg-teal-500/10 px-2.5 py-0.5 font-mono text-xs text-teal-300">
            <span>{step.server_name ?? "—"}</span>
            <span className="text-slate-500">/</span>
            <span className="font-semibold">{step.tool_name ?? "—"}</span>
          </div>
        ) : (
          step.tool_name && <span className="font-mono text-xs text-teal-300">{step.tool_name}</span>
        )}
        <StepBadge status={step.status} />
        <span className="ml-auto font-mono text-xs text-slate-400">{fmtDuration(step.duration_ms)}</span>
      </div>

      {hasArgs && (
        <div className="mt-3">
          <p className="label">Arguments</p>
          <JsonView value={step.arguments} maxHeight="10rem" />
        </div>
      )}

      {step.status === "awaiting_approval" && step.approval_id !== null && (
        <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5">
          <p className="mb-2.5 text-xs font-medium text-amber-200">
            Human approval #{step.approval_id} is required before this tool executes.
          </p>
          <ApprovalActions approvalId={step.approval_id} onDecided={onDecided} />
        </div>
      )}

      {step.error && (
        <div className="mt-3">
          <ErrorBox message={step.error} />
        </div>
      )}

      {step.result !== null && step.result !== undefined && (
        <div className="mt-3">
          <button className="btn btn-sm" onClick={() => setShowResult((s) => !s)}>
            {showResult ? "Hide tool output" : "Inspect tool output"}
          </button>
          {showResult && (
            <div className="mt-2.5">
              <ResultView data={step.result} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
