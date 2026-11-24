import { useCallback, useEffect, useRef, useState } from "react";
import { runsApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Run, Step } from "../api/types";
import { fmtCost, fmtDuration, fmtNum } from "../lib/format";
import { isRunActive } from "../lib/status";
import { RunBadge } from "./Badge";
import { StepCard } from "./StepCard";
import { ErrorBox, Loading } from "./ui";

function currentTask(run: Run): string | null {
  if (!isRunActive(run.status)) return null;
  const active: Step | undefined = [...run.steps].reverse().find((s) => s.status === "running" || s.status === "awaiting_approval");
  if (active) {
    const what = active.kind === "tool_call" ? `${active.server_name ?? "?"}.${active.tool_name ?? "?"}` : active.kind;
    return active.status === "awaiting_approval" ? `Waiting for approval of ${what}` : `Executing ${what}`;
  }
  return run.status === "pending" ? "Queued…" : "Planning next step…";
}

export function RunPanel({ runId, onSettled, defaultOpen = true }: { runId: number; onSettled?: (run: Run) => void; defaultOpen?: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [cancelling, setCancelling] = useState(false);
  const timer = useRef<number | null>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const alive = useRef(true);
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await runsApi.get(runId);
      if (!alive.current) return;
      setRun(r);
      setError(null);
      if (isRunActive(r.status)) {
        timer.current = window.setTimeout(() => void load(), 1000);
      } else if (lastStatus.current !== r.status) {
        settledRef.current?.(r);
      }
      lastStatus.current = r.status;
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e));
    }
  }, [runId]);

  useEffect(() => {
    alive.current = true;
    lastStatus.current = null;
    setRun(null);
    void load();
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [load]);

  const refreshNow = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    void load();
  }, [load]);

  async function cancel() {
    setCancelling(true);
    try {
      const r = await runsApi.cancel(runId);
      setRun(r);
      refreshNow();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  }

  if (!run) return error ? <ErrorBox message={error} onRetry={refreshNow} /> : <Loading label={`Loading run #${runId}…`} />;

  const task = currentTask(run);
  const active = isRunActive(run.status);

  return (
    <div className="rounded-2xl border border-bg-border/90 bg-bg-panel/95 shadow-soft">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-lg bg-bg-raised px-2 py-0.5 font-mono text-xs font-medium text-slate-400">Run #{run.id}</span>
          <RunBadge status={run.status} />
          {active && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-teal-400" aria-hidden />}
          <span className="font-mono text-xs text-slate-400">{fmtDuration(run.duration_ms)}</span>
          <div className="ml-auto flex items-center gap-2">
            {active && (
              <button className="btn btn-danger btn-sm" disabled={cancelling} onClick={() => void cancel()}>
                {cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide steps" : `Show steps (${run.steps.length})`}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-bg-border/60 bg-bg/60 px-3.5 py-2.5 text-sm">
          <span className="label mb-0.5 block">Objective</span>
          <span className="break-words text-slate-200">{run.objective || "—"}</span>
        </div>

        {task && (
          <div className="flex items-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3.5 py-2 text-sm text-teal-300">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-teal-400" />
            <span className="font-medium">{task}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          <span>
            Tokens: <strong className="font-mono text-slate-300">{fmtNum(run.prompt_tokens)}</strong> in +{" "}
            <strong className="font-mono text-slate-300">{fmtNum(run.completion_tokens)}</strong> out
          </span>
          <span>
            Est. Cost: <strong className="font-mono text-slate-300">{fmtCost(run.cost_usd)}</strong>
          </span>
          <span>
            Steps: <strong className="font-mono text-slate-300">{run.step_count}</strong>
          </span>
        </div>
        {error && <ErrorBox message={error} onRetry={refreshNow} />}
        {run.error && <ErrorBox message={run.error} />}
      </div>

      {open && (
        <div className="border-t border-bg-border/70 p-4">
          {run.steps.length === 0 ? (
            <p className="text-sm text-slate-400">{active ? "Preparing execution plan…" : "This run recorded no steps."}</p>
          ) : (
            <ol className="space-y-2.5">
              {run.steps.map((s) => (
                <StepCard key={s.id} step={s} onDecided={refreshNow} />
              ))}
            </ol>
          )}
        </div>
      )}

      {run.final_summary && (
        <div className="border-t border-bg-border/70 bg-bg/40 p-4 rounded-b-2xl">
          <p className="label">Execution Summary</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">{run.final_summary}</p>
        </div>
      )}
    </div>
  );
}
