import { useCallback, useEffect, useRef, useState } from "react";
import { approvalsApi, mcpApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Approval, ToolCallRequest, ToolCallResult } from "../api/types";
import { isApprovalFinal } from "../lib/status";

export interface ToolCallState {
  running: boolean;
  /** Network/HTTP-level error (not a tool failure). */
  requestError: string | null;
  result: ToolCallResult | null;
  /** Latest state of the approval, polled while a call is awaiting approval. */
  approval: Approval | null;
}

const EMPTY: ToolCallState = { running: false, requestError: null, result: null, approval: null };

/** Invoke a tool via /mcp/tools/call. If it awaits approval, poll the approval until it is final. */
export function useToolCall() {
  const [state, setState] = useState<ToolCallState>(EMPTY);
  const pollRef = useRef<number | null>(null);
  const seq = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPoll, [stopPoll]);

  const refreshApproval = useCallback(async (id: number, mySeq: number) => {
    try {
      const a = await approvalsApi.get(id);
      if (seq.current !== mySeq) return;
      setState((s) => ({ ...s, approval: a }));
      if (isApprovalFinal(a.status)) stopPoll();
    } catch (e) {
      if (seq.current !== mySeq) return;
      setState((s) => ({ ...s, requestError: errorMessage(e) }));
    }
  }, [stopPoll]);

  const call = useCallback(
    async (req: ToolCallRequest): Promise<ToolCallResult | null> => {
      stopPoll();
      const mySeq = ++seq.current;
      setState({ ...EMPTY, running: true });
      try {
        const res = await mcpApi.callTool(req);
        if (seq.current !== mySeq) return res;
        setState({ running: false, requestError: null, result: res, approval: null });
        if (res.status === "awaiting_approval" && res.approval_id !== null) {
          const id = res.approval_id;
          void refreshApproval(id, mySeq);
          pollRef.current = window.setInterval(() => void refreshApproval(id, mySeq), 2000);
        }
        return res;
      } catch (e) {
        if (seq.current === mySeq) setState({ ...EMPTY, requestError: errorMessage(e) });
        return null;
      }
    },
    [refreshApproval, stopPoll],
  );

  const reset = useCallback(() => {
    stopPoll();
    seq.current++;
    setState(EMPTY);
  }, [stopPoll]);

  const refresh = useCallback(() => {
    const id = state.result?.approval_id;
    if (id != null) void refreshApproval(id, seq.current);
  }, [state.result, refreshApproval]);

  return { state, call, reset, refresh };
}
