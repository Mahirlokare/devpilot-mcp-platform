import { useMemo, useState } from "react";
import type { JsonSchema } from "../api/types";
import { toPrettyJson } from "../lib/format";

type Values = Record<string, string>;

function primaryType(s: JsonSchema): string {
  if (Array.isArray(s.type)) return s.type.find((t) => t !== "null") ?? "string";
  return s.type ?? (s.properties ? "object" : "string");
}

function initial(s: JsonSchema): string {
  if (s.default !== undefined) return typeof s.default === "string" ? s.default : toPrettyJson(s.default);
  return "";
}

/**
 * Build the arguments object from raw field values.
 * Returns { args } or { error }. Empty optional fields are omitted.
 */
export function buildArguments(schema: JsonSchema, values: Values): { args: Record<string, unknown> } | { error: string } {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const args: Record<string, unknown> = {};
  for (const [name, ps] of Object.entries(props)) {
    const raw = values[name] ?? "";
    const t = primaryType(ps);
    if (raw === "") {
      if (t === "boolean" && required.has(name)) {
        args[name] = false;
        continue;
      }
      if (required.has(name)) return { error: `"${name}" is required.` };
      continue;
    }
    try {
      if (t === "integer") {
        const n = Number(raw);
        if (!Number.isInteger(n)) return { error: `"${name}" must be an integer.` };
        args[name] = n;
      } else if (t === "number") {
        const n = Number(raw);
        if (Number.isNaN(n)) return { error: `"${name}" must be a number.` };
        args[name] = n;
      } else if (t === "boolean") {
        args[name] = raw === "true";
      } else if (t === "object" || t === "array") {
        args[name] = JSON.parse(raw);
      } else {
        args[name] = raw;
      }
    } catch {
      return { error: `"${name}" must be valid JSON.` };
    }
  }
  return { args };
}

export function SchemaForm({
  schema,
  onSubmit,
  submitLabel = "Invoke",
  busy = false,
}: {
  schema: JsonSchema;
  onSubmit: (args: Record<string, unknown>) => void;
  submitLabel?: string;
  busy?: boolean;
}) {
  const props = schema.properties ?? {};
  const names = Object.keys(props);
  const required = useMemo(() => new Set(schema.required ?? []), [schema]);
  const [values, setValues] = useState<Values>(() => Object.fromEntries(names.map((n) => [n, initial(props[n])])));
  const [rawMode, setRawMode] = useState(names.length === 0);
  const [rawText, setRawText] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rawMode) {
      try {
        const parsed: unknown = JSON.parse(rawText || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setError("Arguments must be a JSON object.");
          return;
        }
        onSubmit(parsed as Record<string, unknown>);
      } catch {
        setError("Invalid JSON.");
      }
      return;
    }
    const r = buildArguments(schema, values);
    if ("error" in r) setError(r.error);
    else onSubmit(r.args);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex justify-end">
        {names.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setRawMode((m) => !m)}>
            {rawMode ? "Use form" : "Edit raw JSON"}
          </button>
        )}
      </div>
      {rawMode ? (
        <textarea
          className="input h-40 font-mono text-xs"
          aria-label="Arguments JSON"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          spellCheck={false}
        />
      ) : (
        names.map((n) => {
          const ps = props[n];
          const t = primaryType(ps);
          const id = `f-${n}`;
          return (
            <div key={n}>
              <label htmlFor={id} className="label">
                {n}
                {required.has(n) && <span className="text-red-400"> *</span>}
                <span className="ml-2 normal-case text-slate-500">{t}</span>
              </label>
              {ps.enum ? (
                <select id={id} className="input" value={values[n]} onChange={(e) => setValues({ ...values, [n]: e.target.value })}>
                  <option value="">{required.has(n) ? "Select…" : "(unset)"}</option>
                  {ps.enum.map((o) => (
                    <option key={String(o)} value={String(o)}>
                      {String(o)}
                    </option>
                  ))}
                </select>
              ) : t === "boolean" ? (
                <select id={id} className="input" value={values[n]} onChange={(e) => setValues({ ...values, [n]: e.target.value })}>
                  <option value="">(unset)</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : t === "object" || t === "array" || n === "content" || n === "sql" || n === "body" ? (
                <textarea
                  id={id}
                  className="input h-24 font-mono text-xs"
                  placeholder={t === "string" ? "" : "JSON"}
                  value={values[n]}
                  onChange={(e) => setValues({ ...values, [n]: e.target.value })}
                  spellCheck={false}
                />
              ) : (
                <input
                  id={id}
                  className="input"
                  type={t === "integer" || t === "number" ? "number" : "text"}
                  value={values[n]}
                  onChange={(e) => setValues({ ...values, [n]: e.target.value })}
                />
              )}
              {ps.description && <p className="mt-1 text-xs text-slate-500">{ps.description}</p>}
            </div>
          );
        })
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Running…" : submitLabel}
      </button>
    </form>
  );
}
