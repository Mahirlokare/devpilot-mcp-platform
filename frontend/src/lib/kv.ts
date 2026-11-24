/** Parse "KEY=VALUE" lines into a record. Returns an error string for malformed lines. */
export function parseKeyValueLines(text: string): { value: Record<string, string> } | { error: string } {
  const out: Record<string, string> = {};
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) return { error: `Line ${i + 1}: expected KEY=VALUE.` };
    out[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }
  return { value: out };
}

export function parseArgLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
