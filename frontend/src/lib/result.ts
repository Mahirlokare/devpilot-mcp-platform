// Helpers for tool results of unknown shape. Everything stays plain data (rendered as text only).

function tryParse(s: string): unknown {
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return s;
  try {
    return JSON.parse(t);
  } catch {
    return s;
  }
}

/** Unwrap MCP-style content envelopes and JSON-encoded strings into plain data. */
export function unwrapResult(result: unknown): unknown {
  if (typeof result === "string") return tryParse(result);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const o = result as Record<string, unknown>;
    if ("structuredContent" in o && o.structuredContent != null) return unwrapResult(o.structuredContent);
    if (Array.isArray(o.content) && o.content.length > 0 && Object.keys(o).every((k) => ["content", "isError", "is_error"].includes(k))) {
      const texts = o.content
        .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : null))
        .filter((t): t is string => t !== null);
      if (texts.length === o.content.length) {
        return texts.length === 1 ? tryParse(texts[0]) : texts.join("\n");
      }
    }
  }
  return result;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function isRowArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every(isRecord);
}

/** Find a list of records in the data: the data itself or its single/first array-of-records property. */
export function findRows(data: unknown): Record<string, unknown>[] | null {
  const d = unwrapResult(data);
  if (isRowArray(d)) return d;
  if (isRecord(d)) {
    for (const v of Object.values(d)) {
      const u = unwrapResult(v);
      if (isRowArray(u)) return u;
    }
  }
  return null;
}

/** Find a list of strings/anything primitive (e.g. table names). */
export function findList(data: unknown): unknown[] | null {
  const d = unwrapResult(data);
  if (Array.isArray(d)) return d;
  if (isRecord(d)) {
    for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  }
  return null;
}

export function pick(obj: unknown, keys: string[]): string | null {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
