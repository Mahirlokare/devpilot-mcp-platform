import { useState } from "react";
import type { JsonSchema } from "../api/types";
import { toPrettyJson } from "../lib/format";

/** Untrusted data is always rendered as text inside <pre>. */
export function JsonView({ value, maxHeight = "20rem" }: { value: unknown; maxHeight?: string }) {
  const text = toPrettyJson(value);
  return (
    <pre className="code" style={{ maxHeight }}>
      {text === "" ? "(empty)" : text}
    </pre>
  );
}

function typeLabel(s: JsonSchema): string {
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.enum) return "enum";
  return s.type ?? "any";
}

export function SchemaViewer({ schema }: { schema: JsonSchema | null | undefined }) {
  const [raw, setRaw] = useState(false);
  if (!schema || Object.keys(schema).length === 0) return <p className="text-sm text-slate-400">No input schema.</p>;
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const names = Object.keys(props);
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button className="btn btn-sm" onClick={() => setRaw((r) => !r)}>
          {raw ? "Parameter table" : "Raw JSON schema"}
        </button>
      </div>
      {raw || names.length === 0 ? (
        <JsonView value={schema} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Parameter</th>
                <th className="th">Type</th>
                <th className="th">Required</th>
                <th className="th">Description</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}>
                  <td className="td font-mono text-xs">{n}</td>
                  <td className="td font-mono text-xs text-sky-300">
                    {typeLabel(props[n])}
                    {props[n].enum ? `: ${props[n].enum!.map(String).join(", ")}` : ""}
                  </td>
                  <td className="td text-xs">{required.has(n) ? "yes" : "no"}</td>
                  <td className="td text-xs text-slate-400">{props[n].description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
