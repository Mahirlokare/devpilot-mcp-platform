import { useMemo, useState } from "react";
import { mcpApi } from "../api/endpoints";
import type { Tool } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useToolCall } from "../hooks/useToolCall";
import { RiskBadge } from "../components/Badge";
import { SchemaViewer } from "../components/JsonView";
import { ProjectSelect } from "../components/ProjectSelect";
import { SchemaForm } from "../components/SchemaForm";
import { ToolCallPanel } from "../components/ToolCallPanel";
import { Async, Card, EmptyState, Field, PageHeader } from "../components/ui";

export default function ToolsPage() {
  const tools = useAsync(() => mcpApi.tools(), []);
  const [serverFilter, setServerFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Tool | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const call = useToolCall();

  const servers = useMemo(() => {
    const s = new Set<string>();
    for (const t of tools.data ?? []) s.add(t.server_name);
    return Array.from(s).sort();
  }, [tools.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tools.data ?? []).filter((t) => {
      if (serverFilter && t.server_name !== serverFilter) return false;
      if (riskFilter && t.risk !== riskFilter) return false;
      if (q && !`${t.server_name}.${t.name} ${t.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tools.data, serverFilter, riskFilter, query]);

  function selectTool(t: Tool) {
    setSelected(t);
    call.reset();
  }

  return (
    <div>
      <PageHeader
        title="Tool Explorer"
        subtitle="Inspect every tool exposed by connected MCP servers, view JSON schemas, and invoke tools manually."
        actions={
          <button className="btn" onClick={tools.reload}>
            Refresh tools
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Search">
          <input
            className="input"
            placeholder="Filter by name or description…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label="Server">
          <select className="input" value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Risk">
          <select className="input" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
            <option value="">All risks</option>
            <option value="read">read</option>
            <option value="write">write</option>
            <option value="destructive">destructive</option>
          </select>
        </Field>
        <Field label="Project context">
          <ProjectSelect value={projectId} onChange={setProjectId} />
        </Field>
      </div>

      <Async loading={tools.loading} error={tools.error} onRetry={tools.reload}>
        {(tools.data ?? []).length === 0 ? (
          <EmptyState>No tools available. Connect at least one MCP server on the MCP Servers page.</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
            <Card title={`Tools (${filtered.length})`}>
              {filtered.length === 0 ? (
                <EmptyState>No tools match the current filters.</EmptyState>
              ) : (
                <ul className="max-h-[36rem] space-y-1.5 overflow-y-auto">
                  {filtered.map((t) => {
                    const key = `${t.server_id}:${t.name}`;
                    const isSel = selected && selected.server_id === t.server_id && selected.name === t.name;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => selectTool(t)}
                          className={`w-full rounded border px-2.5 py-2 text-left transition ${
                            isSel
                              ? "border-sky-500/60 bg-sky-500/15"
                              : "border-bg-border bg-bg hover:border-slate-600"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="font-mono text-xs text-sky-300">
                              {t.server_name}.{t.name}
                            </span>
                            <RiskBadge risk={t.risk} />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">{t.description || "No description"}</p>
                          {t.requires_approval && (
                            <span className="mt-1 inline-block text-[11px] text-amber-300">Requires approval</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <div className="min-w-0 space-y-4">
              {!selected ? (
                <EmptyState>Select a tool on the left to inspect its schema and invoke it.</EmptyState>
              ) : (
                <>
                  <Card
                    title={
                      <span className="font-mono">
                        {selected.server_name}.{selected.name}
                      </span>
                    }
                    actions={
                      <div className="flex items-center gap-2">
                        <RiskBadge risk={selected.risk} />
                        {selected.requires_approval && (
                          <span className="text-xs text-amber-300">requires approval</span>
                        )}
                      </div>
                    }
                  >
                    <p className="mb-3 text-sm text-slate-300">{selected.description || "No description provided."}</p>
                    <h3 className="label mb-1">Input Schema</h3>
                    <SchemaViewer schema={selected.input_schema} />
                  </Card>

                  <Card title="Manual Invocation">
                    <SchemaForm
                      key={`${selected.server_id}:${selected.name}`}
                      schema={selected.input_schema}
                      busy={call.state.running}
                      submitLabel={`Invoke ${selected.name}`}
                      onSubmit={(args) =>
                        void call.call({
                          server_id: selected.server_id,
                          server_name: selected.server_name,
                          tool: selected.name,
                          arguments: args,
                          project_id: projectId,
                        })
                      }
                    />
                  </Card>

                  {(call.state.running || call.state.requestError || call.state.result) && (
                    <Card title="Execution Result">
                      <ToolCallPanel state={call.state} onRefresh={call.refresh} />
                    </Card>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}
