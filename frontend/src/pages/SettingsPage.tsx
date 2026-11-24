import { useState, type FormEvent } from "react";
import { permissionsApi, settingsApi, usersApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Role, RuleEffect } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { fmtDate } from "../lib/format";
import { Badge } from "../components/Badge";
import { Async, Card, EmptyState, ErrorBox, Field, Notice, PageHeader } from "../components/ui";

function UsersAdminSection() {
  const users = useAsync(() => usersApi.list(), []);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateRole(id: number, role: Role) {
    setBusyId(id);
    setError(null);
    try {
      await usersApi.setRole(id, role);
      users.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title="Users & Roles (Admin)">
      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}
      <Async loading={users.loading} error={users.error} onRetry={users.reload}>
        {(users.data ?? []).length === 0 ? (
          <EmptyState>No users found.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">ID</th>
                  <th className="th">Username</th>
                  <th className="th">Role</th>
                  <th className="th">Created</th>
                </tr>
              </thead>
              <tbody>
                {(users.data ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className="td font-mono text-xs">{u.id}</td>
                    <td className="td font-medium">{u.username}</td>
                    <td className="td">
                      <select
                        className="input w-36"
                        aria-label={`Role for ${u.username}`}
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) => void updateRole(u.id, e.target.value as Role)}
                      >
                        <option value="admin">admin</option>
                        <option value="developer">developer</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td className="td text-xs text-slate-400">{fmtDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </Card>
  );
}

function PermissionsAdminSection() {
  const rules = useAsync(() => permissionsApi.list(), []);
  const [role, setRole] = useState<Role | "*">("developer");
  const [serverPattern, setServerPattern] = useState("*");
  const [toolPattern, setToolPattern] = useState("*");
  const [effect, setEffect] = useState<RuleEffect>("require_approval");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addRule(e: FormEvent) {
    e.preventDefault();
    if (!serverPattern.trim() || !toolPattern.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await permissionsApi.create({
        role,
        server_pattern: serverPattern.trim(),
        tool_pattern: toolPattern.trim(),
        effect,
      });
      rules.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: number) {
    setBusy(true);
    setError(null);
    try {
      await permissionsApi.remove(id);
      rules.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Permission Rules (Admin)">
      <p className="mb-3 text-xs text-slate-400">
        fnmatch patterns evaluated against <code>role</code>, <code>server_name</code>, and <code>tool_name</code>.
      </p>
      <form onSubmit={addRule} className="mb-4 grid gap-3 sm:grid-cols-5">
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role | "*")}>
            <option value="*">* (any)</option>
            <option value="admin">admin</option>
            <option value="developer">developer</option>
            <option value="viewer">viewer</option>
          </select>
        </Field>
        <Field label="Server pattern">
          <input
            className="input font-mono"
            required
            value={serverPattern}
            onChange={(e) => setServerPattern(e.target.value)}
            placeholder="* or github"
          />
        </Field>
        <Field label="Tool pattern">
          <input
            className="input font-mono"
            required
            value={toolPattern}
            onChange={(e) => setToolPattern(e.target.value)}
            placeholder="* or create_*"
          />
        </Field>
        <Field label="Effect">
          <select className="input" value={effect} onChange={(e) => setEffect(e.target.value as RuleEffect)}>
            <option value="allow">allow</option>
            <option value="require_approval">require_approval</option>
            <option value="deny">deny</option>
          </select>
        </Field>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            Add rule
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      <Async loading={rules.loading} error={rules.error} onRetry={rules.reload}>
        {(rules.data ?? []).length === 0 ? (
          <EmptyState>No custom permission rules defined.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">ID</th>
                  <th className="th">Role</th>
                  <th className="th">Server Pattern</th>
                  <th className="th">Tool Pattern</th>
                  <th className="th">Effect</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {(rules.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="td font-mono text-xs">{r.id}</td>
                    <td className="td font-mono text-xs">{r.role}</td>
                    <td className="td font-mono text-xs text-sky-300">{r.server_pattern}</td>
                    <td className="td font-mono text-xs text-sky-300">{r.tool_pattern}</td>
                    <td className="td">
                      <Badge
                        tone={
                          r.effect === "allow"
                            ? "success"
                            : r.effect === "deny"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {r.effect}
                      </Badge>
                    </td>
                    <td className="td text-right">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busy}
                        onClick={() => void removeRule(r.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </Card>
  );
}

export default function SettingsPage() {
  const { user, can } = useAuth();
  const settings = useAsync(() => settingsApi.get(), []);
  const isAdmin = can("admin");

  return (
    <div>
      <PageHeader
        title="Settings & Access Control"
        subtitle="Inspect platform runtime configuration, manage user roles, and configure tool permission rules."
      />

      <div className="space-y-4">
        {user && (
          <Card title="Current Session">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="label">Username</p>
                <p className="font-mono">{user.username}</p>
              </div>
              <div>
                <p className="label">Role</p>
                <p className="font-mono text-sky-300">{user.role}</p>
              </div>
              <div>
                <p className="label">Member since</p>
                <p className="text-slate-300">{fmtDate(user.created_at)}</p>
              </div>
            </div>
          </Card>
        )}

        <Card title="Platform Runtime Configuration">
          <Async loading={settings.loading} error={settings.error} onRetry={settings.reload}>
            {settings.data && (
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="label">Environment</p>
                  <p className="font-mono">{settings.data.environment}</p>
                </div>
                <div>
                  <p className="label">Model</p>
                  <p className="font-mono text-sky-300">{settings.data.model}</p>
                </div>
                <div>
                  <p className="label">OpenAI API Key</p>
                  <Badge tone={settings.data.openai_configured ? "success" : "warning"}>
                    {settings.data.openai_configured ? "Configured" : "Not configured (planner fallback)"}
                  </Badge>
                </div>
                <div>
                  <p className="label">GitHub OAuth</p>
                  <Badge tone={settings.data.github_oauth_configured ? "success" : "muted"}>
                    {settings.data.github_oauth_configured ? "Configured" : "Not configured"}
                  </Badge>
                </div>
                <div>
                  <p className="label">Max Steps / Run</p>
                  <p className="font-mono">{settings.data.max_steps}</p>
                </div>
                <div>
                  <p className="label">Timeouts</p>
                  <p className="font-mono">
                    Run: {settings.data.run_timeout_seconds}s · Tool: {settings.data.tool_timeout_seconds}s
                  </p>
                </div>
              </div>
            )}
          </Async>
        </Card>

        {isAdmin ? (
          <>
            <UsersAdminSection />
            <PermissionsAdminSection />
          </>
        ) : (
          <Notice>
            User role management and permission rule administration are restricted to <code>admin</code> users.
          </Notice>
        )}
      </div>
    </div>
  );
}
