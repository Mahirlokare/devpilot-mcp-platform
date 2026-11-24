import { describe, expect, it } from "vitest";
import {
  approvalBadge,
  isApprovalFinal,
  isRunActive,
  riskBadge,
  runBadge,
  serverBadge,
  stepBadge,
} from "../lib/status";
import { toolFailure } from "../hooks/useToolQuery";

describe("status and approval badge logic", () => {
  it("never marks pending or approved-but-unexecuted approvals as success", () => {
    expect(approvalBadge("pending")).toEqual({ label: "Pending approval", tone: "warning" });
    expect(approvalBadge("approved")).toEqual({ label: "Approved (not yet executed)", tone: "info" });
    expect(approvalBadge("executed")).toEqual({ label: "Executed", tone: "success" });
    expect(approvalBadge("denied").tone).toBe("danger");
    expect(approvalBadge("failed").tone).toBe("danger");
    expect(approvalBadge("expired").tone).toBe("muted");
  });

  it("identifies terminal approval states properly", () => {
    expect(isApprovalFinal("pending")).toBe(false);
    expect(isApprovalFinal("approved")).toBe(false);
    expect(isApprovalFinal("executed")).toBe(true);
    expect(isApprovalFinal("failed")).toBe(true);
    expect(isApprovalFinal("denied")).toBe(true);
    expect(isApprovalFinal("expired")).toBe(true);
  });

  it("maps step, run, server, and risk badges accurately", () => {
    expect(stepBadge("awaiting_approval")).toEqual({ label: "Awaiting approval", tone: "warning" });
    expect(stepBadge("succeeded")).toEqual({ label: "Succeeded", tone: "success" });
    expect(stepBadge("denied").tone).toBe("danger");

    expect(runBadge("running").tone).toBe("info");
    expect(runBadge("completed").tone).toBe("success");
    expect(isRunActive("pending")).toBe(true);
    expect(isRunActive("running")).toBe(true);
    expect(isRunActive("awaiting_approval")).toBe(true);
    expect(isRunActive("completed")).toBe(false);
    expect(isRunActive("failed")).toBe(false);

    expect(serverBadge("connected").tone).toBe("success");
    expect(serverBadge("error").tone).toBe("danger");

    expect(riskBadge("read").tone).toBe("success");
    expect(riskBadge("write").tone).toBe("warning");
    expect(riskBadge("destructive").tone).toBe("danger");
  });

  it("treats awaiting_approval tool call results as non-executed in read queries", () => {
    expect(
      toolFailure({
        status: "awaiting_approval",
        result: null,
        error: null,
        approval_id: 42,
        duration_ms: 12,
      }),
    ).toContain("approval #42");
    expect(
      toolFailure({
        status: "succeeded",
        result: { ok: true },
        error: null,
        approval_id: null,
        duration_ms: 5,
      }),
    ).toBeNull();
  });
});
