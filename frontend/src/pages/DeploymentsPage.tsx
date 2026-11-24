import { useMemo, useState } from "react";
import { useToolCall } from "../hooks/useToolCall";
import { useToolQuery } from "../hooks/useToolQuery";
import { findRows, pick } from "../lib/result";
import { ToolCallPanel } from "../components/ToolCallPanel";
import { ToolQueryView } from "../components/ToolQueryView";
import { Card, EmptyState, Field, Notice, PageHeader } from "../components/ui";

export default function DeploymentsPage() {
  const [provider, setProvider] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [deploymentId, setDeploymentId] = useState<string>("");

  const servicesArgs = useMemo(() => (provider ? { provider } : {}), [provider]);
  const services = useToolQuery("deployment", "list_services", servicesArgs, true);

  const deploymentsArgs = useMemo(
    () => (provider ? { provider, service_id: serviceId } : { service_id: serviceId }),
    [provider, serviceId],
  );
  const deployments = useToolQuery("deployment", "list_deployments", deploymentsArgs, !!serviceId.trim());

  const logsCall = useToolCall();
  const actionCall = useToolCall();

  function fetchLogs() {
    if (!serviceId.trim()) return;
    const args: Record<string, unknown> = { service_id: serviceId.trim() };
    if (provider) args.provider = provider;
    if (deploymentId.trim()) args.deployment_id = deploymentId.trim();
    void logsCall.call({
      server_name: "deployment",
      tool: "get_logs",
      arguments: args,
    });
  }

  function triggerDeployment() {
    if (!serviceId.trim()) return;
    const args: Record<string, unknown> = { service_id: serviceId.trim() };
    if (provider) args.provider = provider;
    void actionCall.call({
      server_name: "deployment",
      tool: "trigger_deployment",
      arguments: args,
    });
  }

  function rollbackDeployment() {
    if (!serviceId.trim() || !deploymentId.trim()) return;
    const args: Record<string, unknown> = {
      service_id: serviceId.trim(),
      deployment_id: deploymentId.trim(),
    };
    if (provider) args.provider = provider;
    void actionCall.call({
      server_name: "deployment",
      tool: "rollback",
      arguments: args,
    });
  }

  const serviceRows = useMemo(() => findRows(services.data) ?? [], [services.data]);

  return (
    <div>
      <PageHeader
        title="Deployment Center"
        subtitle="Inspect services and deployments, stream logs, trigger deployments, or roll back via the deployment MCP server."
        actions={
          <button className="btn" onClick={services.reload}>
            Refresh services
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Provider">
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">All / default</option>
            <option value="render">render</option>
            <option value="vercel">vercel</option>
          </select>
        </Field>
        <Field label="Service ID">
          <input
            className="input font-mono"
            placeholder="srv-… or select a service row below"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          />
        </Field>
        <Field label="Deployment ID (for logs / rollback)">
          <input
            className="input font-mono"
            placeholder="dep-… or select a deployment row below"
            value={deploymentId}
            onChange={(e) => setDeploymentId(e.target.value)}
          />
        </Field>
      </div>

      <div className="space-y-4">
        <Card
          title="Services"
          actions={
            serviceRows.length > 0 ? (
              <span className="text-xs text-slate-400">Click a row to select its service_id</span>
            ) : undefined
          }
        >
          <ToolQueryView
            q={services}
            empty="No services returned."
            onRowClick={(row) => {
              const id = pick(row, ["id", "service_id", "uid", "name"]);
              if (id) setServiceId(id);
              const p = pick(row, ["provider"]);
              if (p && (p === "render" || p === "vercel")) setProvider(p);
            }}
          />
        </Card>

        <Card
          title={serviceId ? `Deployments for ${serviceId}` : "Deployments"}
          actions={
            serviceId ? (
              <button className="btn btn-sm" onClick={deployments.reload}>
                Refresh deployments
              </button>
            ) : undefined
          }
        >
          {!serviceId.trim() ? (
            <EmptyState>Select or enter a Service ID above to load its deployments.</EmptyState>
          ) : (
            <ToolQueryView
              q={deployments}
              empty="No deployments found for this service."
              onRowClick={(row) => {
                const id = pick(row, ["id", "deployment_id", "uid"]);
                if (id) setDeploymentId(id);
              }}
            />
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Deployment Logs"
            actions={
              <button
                className="btn btn-primary btn-sm"
                disabled={!serviceId.trim() || logsCall.state.running}
                onClick={fetchLogs}
              >
                {logsCall.state.running ? "Loading…" : "Fetch logs"}
              </button>
            }
          >
            <p className="mb-2 text-xs text-slate-400">
              Fetches logs for <code>{serviceId || "(no service)"}</code>
              {deploymentId ? ` / deployment ${deploymentId}` : " (latest deployment)"}.
            </p>
            {logsCall.state.running || logsCall.state.requestError || logsCall.state.result ? (
              <ToolCallPanel state={logsCall.state} onRefresh={logsCall.refresh} />
            ) : (
              <EmptyState>Click &ldquo;Fetch logs&rdquo; to inspect deployment output.</EmptyState>
            )}
          </Card>

          <Card title="Trigger Deployment / Rollback">
            <div className="space-y-3">
              <Notice tone="warning">
                <code>trigger_deployment</code> (write) and <code>rollback</code> (destructive) are approval-gated actions.
              </Notice>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!serviceId.trim() || actionCall.state.running}
                  onClick={triggerDeployment}
                >
                  Trigger deployment
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={!serviceId.trim() || !deploymentId.trim() || actionCall.state.running}
                  onClick={rollbackDeployment}
                >
                  Rollback to {deploymentId || "deployment"}
                </button>
              </div>
              {(actionCall.state.running || actionCall.state.requestError || actionCall.state.result) && (
                <div className="border-t border-bg-border pt-3">
                  <ToolCallPanel state={actionCall.state} onRefresh={actionCall.refresh} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
