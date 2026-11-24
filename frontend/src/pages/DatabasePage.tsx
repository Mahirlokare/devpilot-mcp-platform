import { useMemo, useState, type FormEvent } from "react";
import { useToolCall } from "../hooks/useToolCall";
import { useToolQuery } from "../hooks/useToolQuery";
import { findList, findRows, pick } from "../lib/result";
import { ProjectSelect } from "../components/ProjectSelect";
import { ToolCallPanel } from "../components/ToolCallPanel";
import { ToolQueryView } from "../components/ToolQueryView";
import { Card, EmptyState, ErrorBox, Field, PageHeader } from "../components/ui";

export default function DatabasePage() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const tables = useToolQuery("database", "list_tables", {}, true, projectId);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const describe = useToolQuery(
    "database",
    "describe_table",
    selectedTable ? { table: selectedTable } : {},
    !!selectedTable,
    projectId,
  );

  const [sql, setSql] = useState("SELECT 1 AS ok;");
  const [limit, setLimit] = useState(100);
  const queryCall = useToolCall();
  const docsCall = useToolCall();

  const tableNames = useMemo(() => {
    const rows = findRows(tables.data);
    if (rows) {
      return rows
        .map((r) => pick(r, ["table_name", "name", "table", "tablename"]))
        .filter((n): n is string => !!n);
    }
    return (findList(tables.data) ?? []).filter((x): x is string => typeof x === "string");
  }, [tables.data]);

  function runSql(tool: "run_readonly_query" | "explain_query" | "analyze_query", e?: FormEvent) {
    e?.preventDefault();
    if (!sql.trim()) return;
    const args: Record<string, unknown> = { sql: sql.trim() };
    if (tool === "run_readonly_query" && limit > 0) args.limit = limit;
    void queryCall.call({
      server_name: "database",
      tool,
      arguments: args,
      project_id: projectId,
    });
  }

  function generateDocs() {
    void docsCall.call({
      server_name: "database",
      tool: "generate_schema_docs",
      arguments: {},
      project_id: projectId,
    });
  }

  return (
    <div>
      <PageHeader
        title="Database Explorer"
        subtitle="Inspect tables, run read-only SQL queries, explain execution plans, and generate schema documentation via the database MCP server."
        actions={
          <div className="flex items-center gap-2">
            <ProjectSelect value={projectId} onChange={setProjectId} />
            <button className="btn" onClick={tables.reload}>
              Refresh tables
            </button>
            <button className="btn btn-primary" disabled={docsCall.state.running} onClick={generateDocs}>
              {docsCall.state.running ? "Generating…" : "Generate schema docs"}
            </button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title="Tables">
          {tables.loading ? (
            <p className="text-sm text-slate-400">Loading tables…</p>
          ) : tables.error ? (
            <ErrorBox message={tables.error} onRetry={tables.reload} />
          ) : tableNames.length === 0 ? (
            <EmptyState>No tables returned.</EmptyState>
          ) : (
            <ul className="max-h-[30rem] space-y-1 overflow-y-auto">
              {tableNames.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => setSelectedTable(t)}
                    className={`w-full truncate rounded px-2.5 py-1.5 text-left font-mono text-xs ${
                      selectedTable === t ? "bg-sky-500/15 text-sky-300" : "hover:bg-slate-700/40"
                    }`}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          {selectedTable ? (
            <Card
              title={`Table: ${selectedTable}`}
              actions={
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setSql(`SELECT * FROM ${selectedTable} LIMIT 50;`);
                  }}
                >
                  Query table
                </button>
              }
            >
              <ToolQueryView q={describe} empty="No column metadata returned." />
            </Card>
          ) : (
            <EmptyState>Select a table on the left to inspect its columns and types.</EmptyState>
          )}

          <Card title="Read-Only SQL Editor">
            <form onSubmit={(e) => runSql("run_readonly_query", e)} className="space-y-3">
              <Field label="SQL query (read-only)">
                <textarea
                  className="input h-32 font-mono text-xs"
                  aria-label="SQL query"
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  spellCheck={false}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <Field label="Row limit">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={5000}
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value) || 100)}
                    />
                  </Field>
                </div>
                <button type="submit" className="btn btn-primary" disabled={queryCall.state.running}>
                  Run query
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={queryCall.state.running}
                  onClick={() => runSql("explain_query")}
                >
                  Explain
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={queryCall.state.running}
                  onClick={() => runSql("analyze_query")}
                >
                  Analyze
                </button>
              </div>
            </form>
            {(queryCall.state.running || queryCall.state.requestError || queryCall.state.result) && (
              <div className="mt-4 border-t border-bg-border pt-3">
                <ToolCallPanel state={queryCall.state} onRefresh={queryCall.refresh} />
              </div>
            )}
          </Card>

          {(docsCall.state.running || docsCall.state.requestError || docsCall.state.result) && (
            <Card title="Generated Schema Documentation">
              <ToolCallPanel state={docsCall.state} onRefresh={docsCall.refresh} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
