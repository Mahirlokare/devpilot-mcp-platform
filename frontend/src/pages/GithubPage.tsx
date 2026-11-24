import { useMemo, useState } from "react";
import { authApi, githubApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { useToolQuery } from "../hooks/useToolQuery";
import { findList, findRows, pick, unwrapResult } from "../lib/result";
import { ResultView } from "../components/ResultView";
import { ToolQueryView } from "../components/ToolQueryView";
import { Async, Card, EmptyState, ErrorBox, Notice, PageHeader } from "../components/ui";

type Tab = "tree" | "pulls" | "issues" | "commits" | "branches" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "tree", label: "Files" },
  { id: "pulls", label: "Pull requests" },
  { id: "issues", label: "Issues" },
  { id: "commits", label: "Commits" },
  { id: "branches", label: "Branches" },
  { id: "activity", label: "Activity" },
];

function FileViewer({ repo, path }: { repo: string; path: string }) {
  const q = useToolQuery("github", "read_file", { repo, path }, true);
  return (
    <Card title={path}>
      <FileBody q={q} />
    </Card>
  );
}

function FileBody({ q }: { q: ReturnType<typeof useToolQuery> }) {
  if (q.loading) return <p className="text-sm text-slate-400">Loading file…</p>;
  if (q.error) return <ErrorBox message={q.error} />;
  const d = unwrapResult(q.data);
  const text = typeof d === "string" ? d : pick(d, ["content", "text"]);
  return text !== null ? <pre className="code max-h-96">{text}</pre> : <ResultView data={d} />;
}

function RepoDetail({ repo }: { repo: string }) {
  const [tab, setTab] = useState<Tab>("tree");
  const [state, setState] = useState("open");
  const [file, setFile] = useState<string | null>(null);
  const tool = { tree: "get_repository_tree", pulls: "list_pull_requests", issues: "list_issues", commits: "list_commits", branches: "list_branches", activity: "get_repository_activity" }[tab];
  const args = tab === "pulls" || tab === "issues" ? { repo, state } : { repo };
  const q = useToolQuery("github", tool, args, true);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn btn-sm ${tab === t.id ? "btn-primary" : ""}`} onClick={() => { setTab(t.id); setFile(null); }}>
            {t.label}
          </button>
        ))}
        {(tab === "pulls" || tab === "issues") && (
          <select className="input ml-auto w-28" aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="all">all</option>
          </select>
        )}
      </div>
      <ToolQueryView
        q={q}
        empty={`Nothing found for ${tab}.`}
        onRowClick={
          tab === "tree"
            ? (row) => {
                const p = pick(row, ["path", "name"]);
                const type = pick(row, ["type", "kind"]);
                if (p && type !== "tree" && type !== "dir" && type !== "directory") setFile(p);
              }
            : undefined
        }
      />
      {tab === "tree" && file && <FileViewer key={file} repo={repo} path={file} />}
    </div>
  );
}

export default function GithubPage() {
  const { can } = useAuth();
  const status = useAsync(() => githubApi.status(), []);
  const cfg = useAsync(() => authApi.config(), []);
  const connected = status.data?.connected === true;
  const repos = useToolQuery("github", "list_repositories", { limit: 100 }, connected);
  const [repo, setRepo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoNames = useMemo(() => {
    const rows = findRows(repos.data);
    if (!rows) return (findList(repos.data) ?? []).filter((x): x is string => typeof x === "string");
    return rows.map((r) => pick(r, ["full_name", "name"])).filter((n): n is string => !!n);
  }, [repos.data]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { authorize_url } = await githubApi.authorize();
      if (!/^https:\/\//i.test(authorize_url)) throw new Error("Refusing to redirect to a non-HTTPS authorize URL.");
      window.location.assign(authorize_url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect GitHub? The stored token will be deleted.")) return;
    setBusy(true);
    setError(null);
    try {
      await githubApi.disconnect();
      setRepo(null);
      status.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="GitHub Integration" subtitle="Browse repositories through the built-in github MCP server." />
      <Async loading={status.loading} error={status.error} onRetry={status.reload}>
        <Card title="Connection">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {connected ? (
                <>
                  Connected as <span className="font-mono text-emerald-300">{status.data?.login ?? "(unknown login)"}</span>
                </>
              ) : (
                "Not connected."
              )}
            </p>
            {can("admin", "developer") &&
              (connected ? (
                <button className="btn btn-danger" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect
                </button>
              ) : (
                <button className="btn btn-primary" disabled={busy || cfg.data?.github_oauth_configured === false} onClick={() => void connect()}>
                  Connect GitHub
                </button>
              ))}
          </div>
          {!connected && cfg.data?.github_oauth_configured === false && (
            <div className="mt-3">
              <Notice tone="warning">GitHub OAuth is not configured on the server (missing client id/secret), so connecting is unavailable.</Notice>
            </div>
          )}
          {error && <div className="mt-3"><ErrorBox message={error} /></div>}
        </Card>
      </Async>

      {connected && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Card title="Repositories">
            {repos.loading ? (
              <p className="text-sm text-slate-400">Loading repositories…</p>
            ) : repos.error ? (
              <ErrorBox message={repos.error} onRetry={repos.reload} />
            ) : repoNames.length === 0 ? (
              <EmptyState>No repositories returned.</EmptyState>
            ) : (
              <ul className="max-h-[32rem] space-y-1 overflow-y-auto">
                {repoNames.map((n) => (
                  <li key={n}>
                    <button className={`w-full truncate rounded px-2 py-1 text-left font-mono text-xs ${n === repo ? "bg-sky-500/15 text-sky-300" : "hover:bg-slate-700/40"}`} onClick={() => setRepo(n)}>
                      {n}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="min-w-0">{repo ? <Card title={repo}><RepoDetail key={repo} repo={repo} /></Card> : <EmptyState>Select a repository.</EmptyState>}</div>
        </div>
      )}
    </div>
  );
}
