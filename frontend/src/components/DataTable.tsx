import { cellText } from "../lib/result";

export function DataTable({
  rows,
  columns,
  onRowClick,
  maxHeight = "28rem",
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
  onRowClick?: (row: Record<string, unknown>) => void;
  maxHeight?: string;
}) {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return (
    <div className="overflow-auto rounded-md border border-bg-border" style={{ maxHeight }}>
      <table className="w-full min-w-max">
        <thead className="sticky top-0 bg-bg-panel">
          <tr>
            {cols.map((c) => (
              <th key={c} className="th">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={onRowClick ? "cursor-pointer hover:bg-slate-700/30" : ""} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {cols.map((c) => (
                <td key={c} className="td max-w-md break-words font-mono text-xs">
                  {cellText(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
