import type { ApprovalStatus, McpStatus, Risk, RunStatus, StepStatus, ToolCallStatus } from "../api/types";

export type Tone = "success" | "danger" | "warning" | "info" | "neutral" | "muted";

export interface BadgeInfo {
  label: string;
  tone: Tone;
}

/**
 * Approval badge logic. IMPORTANT: only `executed` is rendered as success.
 * `approved` means a human approved it but the API has not reported execution yet.
 */
export function approvalBadge(status: ApprovalStatus | string): BadgeInfo {
  switch (status) {
    case "pending":
      return { label: "Pending approval", tone: "warning" };
    case "approved":
      return { label: "Approved (not yet executed)", tone: "info" };
    case "executed":
      return { label: "Executed", tone: "success" };
    case "denied":
      return { label: "Denied", tone: "danger" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "expired":
      return { label: "Expired", tone: "muted" };
    default:
      return { label: String(status), tone: "neutral" };
  }
}

export function stepBadge(status: StepStatus | string): BadgeInfo {
  switch (status) {
    case "running":
      return { label: "Running", tone: "info" };
    case "awaiting_approval":
      return { label: "Awaiting approval", tone: "warning" };
    case "succeeded":
      return { label: "Succeeded", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "denied":
      return { label: "Denied", tone: "danger" };
    default:
      return { label: String(status), tone: "neutral" };
  }
}

export function toolCallBadge(status: ToolCallStatus | string): BadgeInfo {
  return stepBadge(status);
}

export function runBadge(status: RunStatus | string): BadgeInfo {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "neutral" };
    case "running":
      return { label: "Running", tone: "info" };
    case "awaiting_approval":
      return { label: "Awaiting approval", tone: "warning" };
    case "completed":
      return { label: "Completed", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "muted" };
    default:
      return { label: String(status), tone: "neutral" };
  }
}

export function serverBadge(status: McpStatus | string): BadgeInfo {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "success" };
    case "connecting":
      return { label: "Connecting", tone: "info" };
    case "error":
      return { label: "Error", tone: "danger" };
    case "disconnected":
      return { label: "Disconnected", tone: "muted" };
    default:
      return { label: String(status), tone: "neutral" };
  }
}

export function riskBadge(risk: Risk | string): BadgeInfo {
  switch (risk) {
    case "read":
      return { label: "read", tone: "success" };
    case "write":
      return { label: "write", tone: "warning" };
    case "destructive":
      return { label: "destructive", tone: "danger" };
    default:
      return { label: String(risk), tone: "neutral" };
  }
}

const ACTIVE_RUN: RunStatus[] = ["pending", "running", "awaiting_approval"];
export function isRunActive(status: RunStatus | string): boolean {
  return (ACTIVE_RUN as string[]).includes(status);
}

/** True only when the approval has reached a terminal state. */
export function isApprovalFinal(status: ApprovalStatus | string): boolean {
  return status === "executed" || status === "failed" || status === "denied" || status === "expired";
}
