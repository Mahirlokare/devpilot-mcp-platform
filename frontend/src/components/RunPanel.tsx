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
    return active.status === "awaiting_approval" ? `Waiting for approval of ${what}` : `Running ${what}`;
  }
  return run.status === "pending" ? "Queued…" : "Planning next step…";
}

/** Live view of a run: polls every second while active. */
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
    <div className="rounded-lg border border-bg-border bg-bg-panel">
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-500">run #{run.id}</span>
          <RunBadge status={run.status} />
          {active && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" aria-hidden />}
          <span className="text-xs text-slate-400">{fmtDuration(run.duration_ms)}</span>
          <div className="ml-auto flex items-center gap-2">
            {active && (
              <button className="btn btn-danger btn-sm" disabled={cancelling} onClick={() => void cancel()}>
                {cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
              {open ? "Collapse" : `Expand (${run.steps.length} steps)`}
            </button>
          </div>
        </div>
        <p className="text-sm">
          <span className="label inline">Objective </span>
          <span className="break-words">{run.objective || "—"}</span>
        </p>
        {task && (
          <p className="text-sm text-sky-300">
            <span className="label inline">Current task </span>
            {task}
          </p>
        )}
        <p className="text-xs text-slate-400">
          Tokens: {fmtNum(run.prompt_tokens)} prompt + {fmtNum(run.completion_tokens)} completion · Cost: {fmtCost(run.cost_usd)} · Steps: {run.step_count}
        </p>
        {error && <ErrorBox message={error} onRetry={refreshNow} />}
        {run.error && <ErrorBox message={run.error} />}
      </div>

      {open && (
        <div className="border-t border-bg-border p-3">
          {run.steps.length === 0 ? (
            <p className="text-sm text-slate-400">{active ? "No steps yet…" : "This run recorded no steps."}</p>
          ) : (
            <ol className="space-y-2">
              {run.steps.map((s) => (
                <StepCard key={s.id} step={s} onDecided={refreshNow} />
              ))}
            </ol>
          )}
        </div>
      )}

      {run.final_summary && (
        <div className="border-t border-bg-border p-3">
          <p className="label">Final summary</p>
          <p className="whitespace-pre-wrap break-words text-sm">{run.final_summary}</p>
        </div>
      )}
    </div>
  );
}
