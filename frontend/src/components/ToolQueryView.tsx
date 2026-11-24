import type { ReactNode } from "react";
import type { ToolQuery } from "../hooks/useToolQuery";
import { findRows } from "../lib/result";
import { DataTable } from "./DataTable";
import { ResultView } from "./ResultView";
import { EmptyState, ErrorBox, Loading } from "./ui";

/** Renders the state of a useToolQuery(): loading / error / table or generic result. */
export function ToolQueryView({
  q,
  onRowClick,
  columns,
  empty = "No results.",
  header,
}: {
  q: ToolQuery;
  onRowClick?: (row: Record<string, unknown>) => void;
  columns?: string[];
  empty?: string;
  header?: ReactNode;
}) {
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (q.raw === null) return null;
  const d = q.data;
  const rows = findRows(d);
  const isEmpty = d === null || d === undefined || d === "" || (Array.isArray(d) && d.length === 0);
  return (
    <div className="space-y-2">
      {header}
      {isEmpty ? <EmptyState>{empty}</EmptyState> : rows ? <DataTable rows={rows} columns={columns} onRowClick={onRowClick} /> : <ResultView data={d} />}
    </div>
  );
}
