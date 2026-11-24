import { useState, type FormEvent } from "react";
import { useToolCall } from "../hooks/useToolCall";
import { parseArgLines } from "../lib/kv";
import { ProjectSelect } from "../components/ProjectSelect";
import { ToolCallPanel } from "../components/ToolCallPanel";
import { Card, Field, Notice, PageHeader } from "../components/ui";

export default function TestingPage() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [detectPath, setDetectPath] = useState("");
  const [framework, setFramework] = useState("pytest");
  const [testPath, setTestPath] = useState("");
  const [testArgs, setTestArgs] = useState("");
  const [failureOutput, setFailureOutput] = useState("");

  const detectCall = useToolCall();
  const runCall = useToolCall();
  const analyzeCall = useToolCall();

  function runDetect(e: FormEvent) {
    e.preventDefault();
    const args: Record<string, unknown> = {};
    if (detectPath.trim()) args.path = detectPath.trim();
    void detectCall.call({
      server_name: "testing",
      tool: "detect_frameworks",
      arguments: args,
      project_id: projectId,
    });
  }

  function invokeTestTool(tool: "run_tests" | "run_coverage") {
    if (!framework.trim()) return;
    const args: Record<string, unknown> = { framework: framework.trim() };
    if (testPath.trim()) args.path = testPath.trim();
    if (tool === "run_tests") {
      const parsedArgs = parseArgLines(testArgs);
      if (parsedArgs.length > 0) args.args = parsedArgs;
    }
    void runCall.call({
      server_name: "testing",
      tool,
      arguments: args,
      project_id: projectId,
    });
  }

  function runAnalyzeFailures(e: FormEvent) {
    e.preventDefault();
    if (!failureOutput.trim()) return;
    void analyzeCall.call({
      server_name: "testing",
      tool: "analyze_failures",
      arguments: { output: failureOutput },
      project_id: projectId,
    });
  }

  return (
    <div>
      <PageHeader
        title="Testing Center"
        subtitle="Detect test frameworks, execute tests or coverage suites (with approval gating), and analyze failure logs."
        actions={<ProjectSelect value={projectId} onChange={setProjectId} />}
      />

      <div className="space-y-4">
        <Card title="1. Detect Test Frameworks">
          <form onSubmit={runDetect} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Field label="Subdirectory path (optional)">
                <input
                  className="input font-mono"
                  placeholder=". (leave blank for project root)"
                  value={detectPath}
                  onChange={(e) => setDetectPath(e.target.value)}
                />
              </Field>
            </div>
            <button type="submit" className="btn btn-primary" disabled={detectCall.state.running}>
              {detectCall.state.running ? "Detecting…" : "Detect frameworks"}
            </button>
          </form>
          {(detectCall.state.running || detectCall.state.requestError || detectCall.state.result) && (
            <div className="mt-3 border-t border-bg-border pt-3">
              <ToolCallPanel state={detectCall.state} onRefresh={detectCall.refresh} />
            </div>
          )}
        </Card>

        <Card title="2. Run Tests & Coverage">
          <div className="mb-3">
            <Notice tone="info">
              Running tests or coverage invokes a write-classified tool on the <code>testing</code> server and may require approval before execution.
            </Notice>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Framework">
              <input
                className="input font-mono"
                value={framework}
                onChange={(e) => setFramework(e.target.value)}
                placeholder="pytest | vitest | jest | unittest"
              />
            </Field>
            <Field label="Target path (optional)">
              <input
                className="input font-mono"
                value={testPath}
                onChange={(e) => setTestPath(e.target.value)}
                placeholder="tests/"
              />
            </Field>
            <Field label="Extra args (for run_tests, one per line)">
              <textarea
                className="input h-10 font-mono text-xs"
                value={testArgs}
                onChange={(e) => setTestArgs(e.target.value)}
                placeholder="-q"
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={runCall.state.running || !framework.trim()}
              onClick={() => invokeTestTool("run_tests")}
            >
              {runCall.state.running ? "Running…" : "Run tests"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={runCall.state.running || !framework.trim()}
              onClick={() => invokeTestTool("run_coverage")}
            >
              Run coverage
            </button>
          </div>
          {(runCall.state.running || runCall.state.requestError || runCall.state.result) && (
            <div className="mt-3 border-t border-bg-border pt-3">
              <ToolCallPanel state={runCall.state} onRefresh={runCall.refresh} />
            </div>
          )}
        </Card>

        <Card title="3. Analyze Test Failures">
          <form onSubmit={runAnalyzeFailures} className="space-y-3">
            <Field label="Paste test failure output">
              <textarea
                className="input h-32 font-mono text-xs"
                value={failureOutput}
                onChange={(e) => setFailureOutput(e.target.value)}
                placeholder="Paste stack trace or failing test runner stdout/stderr…"
              />
            </Field>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={analyzeCall.state.running || !failureOutput.trim()}
            >
              {analyzeCall.state.running ? "Analyzing…" : "Analyze failures"}
            </button>
          </form>
          {(analyzeCall.state.running || analyzeCall.state.requestError || analyzeCall.state.result) && (
            <div className="mt-3 border-t border-bg-border pt-3">
              <ToolCallPanel state={analyzeCall.state} onRefresh={analyzeCall.refresh} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
