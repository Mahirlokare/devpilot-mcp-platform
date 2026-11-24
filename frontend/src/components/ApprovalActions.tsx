import { useState } from "react";
import { approvalsApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Approval } from "../api/types";
import { useAuth } from "../hooks/useAuth";
import { ErrorBox } from "./ui";

/** Inline Approve / Deny controls (admin & developer only; viewers are read-only). */
export function ApprovalActions({ approvalId, onDecided, compact = false }: { approvalId: number; onDecided?: (a: Approval) => void; compact?: boolean }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState<null | "approve" | "deny">(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!can("admin", "developer")) {
    return <p className="text-xs text-slate-500">Your role is read-only and cannot decide approvals.</p>;
  }

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    try {
      const a = await approvalsApi.decide(approvalId, approve, comment.trim() || undefined);
      onDecided?.(a);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!compact && (
          <input
            className="input max-w-xs"
            placeholder="Comment (optional)"
            aria-label="Decision comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
        <button className="btn btn-success btn-sm" disabled={busy !== null} onClick={() => void decide(true)}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => void decide(false)}>
          {busy === "deny" ? "Denying…" : "Deny"}
        </button>
      </div>
      {error && <ErrorBox message={error} />}
    </div>
  );
}
