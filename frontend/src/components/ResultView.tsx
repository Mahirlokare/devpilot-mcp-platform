import { useState } from "react";
import { DataTable } from "./DataTable";
import { JsonView } from "./JsonView";
import { cellText, isRecord, isRowArray, unwrapResult } from "../lib/result";

function Section({ name, value }: { name: string; value: unknown }) {
  const v = unwrapResult(value);
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{name}</h4>
      <Value value={v} />
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  if (isRowArray(value)) return <DataTable rows={value} />;
  if (value === null || value === undefined) return <p className="text-sm text-slate-500">(none)</p>;
  if (typeof value === "string") {
    return value.includes("\n") || value.length > 120 ? <pre className="code max-h-96">{value}</pre> : <p className="break-words font-mono text-sm">{value}</p>;
  }
  if (typeof value === "number" || typeof value === "boolean") return <p className="font-mono text-sm">{String(value)}</p>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-sm text-slate-500">(empty list)</p>;
    if (value.every((x) => x === null || typeof x !== "object")) return <pre className="code max-h-96">{value.map(cellText).join("\n")}</pre>;
  }
  return <JsonView value={value} />;
}

/**
 * Generic renderer for tool output of unknown shape: records -> tables, objects -> sections,
 * everything else -> text. A "raw" toggle shows the untouched JSON. Always plain text.
 */
export function ResultView({ data }: { data: unknown }) {
  const [raw, setRaw] = useState(false);
  const d = unwrapResult(data);
  let body;
  if (raw) body = <JsonView value={data} maxHeight="32rem" />;
  else if (isRecord(d) && Object.keys(d).length > 0 && Object.keys(d).length <= 12) {
    body = (
      <div className="space-y-3">
        {Object.entries(d).map(([k, v]) => (
          <Section key={k} name={k} value={v} />
        ))}
      </div>
    );
  } else body = <Value value={d} />;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button className="btn btn-sm" onClick={() => setRaw((r) => !r)}>
          {raw ? "Formatted" : "Raw JSON"}
        </button>
      </div>
      {body}
    </div>
  );
}
