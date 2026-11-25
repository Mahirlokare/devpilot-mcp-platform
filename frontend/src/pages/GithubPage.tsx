import { useMemo, useState, type FormEvent } from "react";
import { authApi, githubApi, websitesApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { WebsiteKind } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { useToolQuery } from "../hooks/useToolQuery";
import { findList, findRows, pick, unwrapResult } from "../lib/result";
import { Badge } from "../components/Badge";
import { ResultView } from "../components/ResultView";
import { ToolQueryView } from "../components/ToolQueryView";
import { Async, Card, EmptyState, ErrorBox, Field, PageHeader, Spinner } from "../components/ui";

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
  const tool = {
    tree: "get_repository_tree",
    pulls: "list_pull_requests",
    issues: "list_issues",
    commits: "list_commits",
    branches: "list_branches",
    activity: "get_repository_activity",
  }[tab];
  const args = tab === "pulls" || tab === "issues" ? { repo, state } : { repo };
  const q = useToolQuery("github", tool, args, true);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`btn btn-sm ${tab === t.id ? "btn-primary" : ""}`}
            onClick={() => {
              setTab(t.id);
              setFile(null);
            }}
          >
            {t.label}
          </button>
        ))}
        {(tab === "pulls" || tab === "issues") && (
          <select
            className="input ml-auto w-28"
            aria-label="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
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
  const websites = useAsync(() => websitesApi.list(), []);
  const connected = status.data?.connected === true;
  const repos = useToolQuery("github", "list_repositories", { limit: 100 }, connected);
  const [repo, setRepo] = useState<string | null>(null);
  const [targetInput, setTargetInput] = useState("https://github.com/Mahirlokare/devpilot-mcp-platform");
  const [tokenInput, setTokenInput] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteKind, setSiteKind] = useState<WebsiteKind>("website");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoNames = useMemo(() => {
    const rows = findRows(repos.data);
    if (!rows) return (findList(repos.data) ?? []).filter((x): x is string => typeof x === "string");
    return rows.map((r) => pick(r, ["full_name", "name"])).filter((n): n is string => !!n);
  }, [repos.data]);

  const activeRepo = repo || status.data?.default_repo || repoNames[0] || null;

  async function connectOAuth() {
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

  async function connectDirect(e?: FormEvent, overrideTarget?: string) {
    if (e) e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await githubApi.connect({
        username_or_repo: (overrideTarget ?? targetInput).trim() || "Mahirlokare/devpilot-mcp-platform",
        token: tokenInput.trim() || null,
      });
      setTokenInput("");
      if (res.default_repo) setRepo(res.default_repo);
      status.reload();
      repos.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect GitHub? The stored credential will be deleted.")) return;
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

  async function addWebsite(e: FormEvent) {
    e.preventDefault();
    if (!siteUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await websitesApi.connect({
        name: siteName.trim() || siteUrl.trim(),
        url: siteUrl.trim(),
        kind: siteKind,
      });
      setSiteName("");
      setSiteUrl("");
      websites.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="GitHub & External Website Integrations"
        subtitle="Connect GitHub repositories (via Personal Access Token, Public URL, or OAuth) and external websites for direct MCP access."
        actions={
          connected ? (
            <Badge tone="success">
              Connected: @{status.data?.login} ({status.data?.mode === "pat" ? "Personal Access Token" : "Public GitHub API"})
            </Badge>
          ) : (
            <Badge tone="muted">Not Connected</Badge>
          )
        }
      />

      <Async loading={status.loading} error={status.error} onRetry={status.reload}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card
            title="GitHub Connection (Repository URL, PAT, or OAuth)"
            actions={
              connected && can("admin", "developer") ? (
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect GitHub
                </button>
              ) : null
            }
          >
            {connected ? (
              <div className="mb-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 text-sm">
                <p className="font-semibold text-emerald-300">
                  GitHub Connected as <span className="font-mono">@{status.data?.login}</span>
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  Mode:{" "}
                  <span className="font-mono">
                    {status.data?.mode === "pat" ? "Authenticated PAT" : "Public GitHub REST API"}
                  </span>
                  {status.data?.default_repo && (
                    <>
                      {" "}
                      · Default Repository: <span className="font-mono text-teal-300">{status.data.default_repo}</span>
                    </>
                  )}
                </p>
              </div>
            ) : null}

            {can("admin", "developer") && (
              <form onSubmit={(e) => void connectDirect(e)} className="space-y-3">
                <Field
                  label="GitHub Repository URL or Username"
                  hint="Enter any public GitHub repo URL (e.g. https://github.com/Mahirlokare/devpilot-mcp-platform) or username."
                >
                  <input
                    className="input font-mono text-xs"
                    placeholder="https://github.com/Mahirlokare/devpilot-mcp-platform"
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                  />
                </Field>
                <Field
                  label="Personal Access Token (Optional for Public Repos)"
                  hint="Paste a GitHub PAT (ghp_... or github_pat_...) for private repositories and write tools."
                >
                  <input
                    className="input font-mono text-xs"
                    type="password"
                    placeholder="ghp_•••••••••••••••••••• (optional)"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button className="btn btn-primary" disabled={busy} type="submit">
                    {busy && <Spinner />} {connected ? "Update GitHub Connection" : "Connect GitHub"}
                  </button>
                  {!connected && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void connectDirect(undefined, "Mahirlokare/devpilot-mcp-platform")}
                    >
                      1-Click Connect DevPilot Repo
                    </button>
                  )}
                  {cfg.data?.github_oauth_configured && (
                    <button type="button" className="btn" disabled={busy} onClick={() => void connectOAuth()}>
                      Connect via GitHub OAuth
                    </button>
                  )}
                </div>
              </form>
            )}
            {error && (
              <div className="mt-3">
                <ErrorBox message={error} />
              </div>
            )}
          </Card>

          <Card title="Connected External Websites & Live APIs">
            <form onSubmit={addWebsite} className="mb-4 grid gap-2.5 sm:grid-cols-[1fr_1.4fr_auto]">
              <input
                className="input text-xs"
                placeholder="Name (e.g. FastAPI Docs)"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />
              <input
                className="input font-mono text-xs"
                placeholder="https://fastapi.tiangolo.com"
                required
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
              />
              <div className="flex gap-1.5">
                <select
                  className="input w-28 text-xs"
                  value={siteKind}
                  onChange={(e) => setSiteKind(e.target.value as WebsiteKind)}
                >
                  <option value="website">Website</option>
                  <option value="rest_api">REST API</option>
                  <option value="openapi">OpenAPI</option>
                  <option value="docs">Docs</option>
                </select>
                <button className="btn btn-primary btn-sm shrink-0" disabled={busy} type="submit">
                  + Connect
                </button>
              </div>
            </form>

            {(websites.data ?? []).length === 0 ? (
              <EmptyState>
                No external websites connected yet. Add any public website, documentation portal, or OpenAPI URL above so DevPilot can fetch it directly.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {(websites.data ?? []).map((w) => (
                  <li
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bg-border bg-bg/60 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">{w.name}</span>
                        <span className="rounded bg-teal-500/15 px-1.5 py-0.2 font-mono text-[10px] uppercase text-teal-300">
                          {w.kind}
                        </span>
                      </div>
                      <a
                        href={w.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate font-mono text-[11px] text-teal-400 hover:underline"
                      >
                        {w.url} ↗
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => void websitesApi.disconnect(w.id).then(() => websites.reload())}
                      className="btn btn-sm text-rose-300 hover:border-rose-500/40"
                    >
                      Disconnect
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Async>

      {connected && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Card title={`Repositories (@${status.data?.login})`}>
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
                    <button
                      className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition ${
                        n === activeRepo
                          ? "bg-teal-500/20 font-semibold text-teal-300 ring-1 ring-teal-500/35"
                          : "hover:bg-bg-raised/70"
                      }`}
                      onClick={() => setRepo(n)}
                    >
                      {n}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="min-w-0">
            {activeRepo ? (
              <Card title={activeRepo}>
                <RepoDetail key={activeRepo} repo={activeRepo} />
              </Card>
            ) : (
              <EmptyState>Select a repository on the left to inspect its files, commits, branches, issues, and PRs.</EmptyState>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
