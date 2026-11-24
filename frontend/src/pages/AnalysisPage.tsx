import { useState, type FormEvent } from "react";
import { useToolCall } from "../hooks/useToolCall";
import { ProjectSelect } from "../components/ProjectSelect";
import { ToolCallPanel } from "../components/ToolCallPanel";
import { Card, Field, PageHeader } from "../components/ui";

type AnalysisTool = "analyze_structure" | "scan_security" | "find_duplicates" | "analyze_file";

const TOOLS: { id: AnalysisTool; label: string; description: string; requiresFile?: boolean }[] = [
  {
    id: "analyze_structure",
    label: "Analyze Structure",
    description: "Inspect directory layout, language breakdown, and module organization.",
  },
  {
    id: "scan_security",
    label: "Security Scan",
    description: "Scan source files for hardcoded secrets, unsafe patterns, and security risks.",
  },
  {
    id: "find_duplicates",
    label: "Find Duplicates",
    description: "Locate duplicate files or repeated blocks inside the workspace.",
  },
  {
    id: "analyze_file",
    label: "Analyze File",
    description: "Inspect a single file's complexity, symbols, imports, and line metrics.",
    requiresFile: true,
  },
];

export default function AnalysisPage() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [tool, setTool] = useState<AnalysisTool>("analyze_structure");
  const [path, setPath] = useState("");
  const call = useToolCall();

  const current = TOOLS.find((t) => t.id === tool)!;

  function run(e: FormEvent) {
    e.preventDefault();
    const trimmed = path.trim();
    if (current.requiresFile && !trimmed) return;
    const args: Record<string, unknown> = {};
    if (trimmed) args.path = trimmed;
    void call.call({
      server_name: "filesystem",
      tool,
      arguments: args,
      project_id: projectId,
    });
  }

  return (
    <div>
      <PageHeader
        title="Code Analysis"
        subtitle="Run static structure, security, duplicate, and file-level analysis on the filesystem MCP server."
        actions={<ProjectSelect value={projectId} onChange={setProjectId} />}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tool === t.id}
            className={`btn ${tool === t.id ? "btn-primary" : ""}`}
            onClick={() => {
              setTool(t.id);
              setPath("");
              call.reset();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card title={current.label}>
        <p className="mb-3 text-sm text-slate-400">{current.description}</p>
        <form onSubmit={run} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <Field
              label={current.requiresFile ? "File path (required, relative to project root)" : "Subdirectory path (optional)"}
            >
              <input
                className="input font-mono"
                required={current.requiresFile}
                placeholder={current.requiresFile ? "src/main.py" : ". (leave blank for project root)"}
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </Field>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={call.state.running || (current.requiresFile && !path.trim())}
          >
            {call.state.running ? "Running…" : `Run ${current.label}`}
          </button>
        </form>
      </Card>

      {(call.state.running || call.state.requestError || call.state.result) && (
        <div className="mt-4">
          <Card title="Analysis Output">
            <ToolCallPanel state={call.state} onRefresh={call.refresh} />
          </Card>
        </div>
      )}
    </div>
  );
}
