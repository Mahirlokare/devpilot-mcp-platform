import { useEffect, useRef, useState } from "react";
import { mcpApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { ToolCallResult } from "../api/types";
import { unwrapResult } from "../lib/result";

export interface ToolQuery {
  data: unknown;
  error: string | null;
  loading: boolean;
  raw: ToolCallResult | null;
  reload: () => void;
}

/** Describe a non-succeeded tool call as an error message. Returns null when succeeded. */
export function toolFailure(r: ToolCallResult): string | null {
  switch (r.status) {
    case "succeeded":
      return null;
    case "awaiting_approval":
      return `This call requires approval (approval #${r.approval_id ?? "?"}). Nothing was executed.`;
    case "denied":
      return r.error || "Denied by policy.";
    default:
      return r.error || "Tool call failed.";
  }
}

/** Declarative read-only tool call on a built-in server (loads when `enabled`). */
export function useToolQuery(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  enabled: boolean,
  projectId?: number | null,
): ToolQuery {
  const [state, setState] = useState<Omit<ToolQuery, "reload">>({ data: null, error: null, loading: false, raw: null });
  const [tick, setTick] = useState(0);
  const argsKey = JSON.stringify(args);
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false, raw: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, error: null, loading: true, raw: null });
    mcpApi
      .callTool({ server_name: server, tool, arguments: argsRef.current, project_id: projectId ?? undefined })
      .then((r) => {
        if (cancelled) return;
        const fail = toolFailure(r);
        setState({ data: fail ? null : unwrapResult(r.result), error: fail, loading: false, raw: r });
      })
      .catch((e) => {
        if (!cancelled) setState({ data: null, error: errorMessage(e), loading: false, raw: null });
      });
    return () => {
      cancelled = true;
    };
  }, [server, tool, argsKey, enabled, projectId, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
