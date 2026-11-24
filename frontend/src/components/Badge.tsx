import type { ReactNode } from "react";
import type { Tone } from "../lib/status";
import { approvalBadge, riskBadge, runBadge, serverBadge, stepBadge, type BadgeInfo } from "../lib/status";

const TONES: Record<Tone, string> = {
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35",
  danger: "bg-rose-500/15 text-rose-300 border-rose-500/35",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/35",
  info: "bg-teal-500/15 text-teal-300 border-teal-500/35",
  neutral: "bg-slate-500/15 text-slate-300 border-slate-500/35",
  muted: "bg-slate-700/25 text-slate-400 border-slate-600/35",
};

const DOT_TONES: Record<Tone, string> = {
  success: "bg-emerald-400",
  danger: "bg-rose-400",
  warning: "bg-amber-400",
  info: "bg-teal-400",
  neutral: "bg-slate-400",
  muted: "bg-slate-500",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONES[tone]}`} aria-hidden />
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
