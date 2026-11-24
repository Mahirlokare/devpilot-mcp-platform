import type { ReactNode } from "react";
import type { Tone } from "../lib/status";
import { approvalBadge, riskBadge, runBadge, serverBadge, stepBadge, type BadgeInfo } from "../lib/status";

const TONES: Record<Tone, string> = {
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  danger: "bg-red-500/15 text-red-300 border-red-500/40",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  neutral: "bg-slate-500/15 text-slate-300 border-slate-500/40",
  muted: "bg-slate-700/30 text-slate-400 border-slate-600/40",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

function fromInfo(info: BadgeInfo) {
  return <Badge tone={info.tone}>{info.label}</Badge>;
}

export const ApprovalBadge = ({ status }: { status: string }) => fromInfo(approvalBadge(status));
export const StepBadge = ({ status }: { status: string }) => fromInfo(stepBadge(status));
export const RunBadge = ({ status }: { status: string }) => fromInfo(runBadge(status));
export const ServerBadge = ({ status }: { status: string }) => fromInfo(serverBadge(status));
export const RiskBadge = ({ risk }: { risk: string }) => fromInfo(riskBadge(risk));
