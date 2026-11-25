import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { conversationsApi, githubApi, websitesApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { ConversationDetail, WebsiteKind } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { fmtDate } from "../lib/format";
import { Badge } from "../components/Badge";
import { ProjectSelect } from "../components/ProjectSelect";
import { RunPanel } from "../components/RunPanel";
import { Async, EmptyState, ErrorBox, Field, Loading, PageHeader, Spinner } from "../components/ui";

const SUGGESTED_PROMPTS = [
  {
    tag: "Architecture & Security",
    prompt: "Explain the project architecture and scan for security vulnerabilities",
  },
  {
    tag: "GitHub Live Access",
    prompt: "Inspect GitHub repository https://github.com/Mahirlokare/devpilot-mcp-platform and list recent commits",
  },
  {
    tag: "Live Website & API",
    prompt: "Fetch and analyze live website https://httpbin.org/json and summarize its response",
  },
  {
    tag: "Database Intelligence",
    prompt: "Inspect the database tables and generate schema documentation",
  },
  {
    tag: "Automated Testing",
    prompt: "Detect test frameworks and run the pytest test suite",
  },
  {
    tag: "Code Quality",
    prompt: "Find duplicate code blocks across the workspace",
  },
];

const WEBSITE_PRESETS: { name: string; url: string; kind: WebsiteKind }[] = [
  {
    name: "DevPilot GitHub Repo",
    url: "https://github.com/Mahirlokare/devpilot-mcp-platform",
    kind: "github",
  },
  {
    name: "HTTPBin Live JSON API",
    url: "https://httpbin.org/json",
    kind: "rest_api",
  },
  {
    name: "Hacker News Tech Feed",
    url: "https://news.ycombinator.com",
    kind: "website",
  },
  {
    name: "FastAPI Documentation",
    url: "https://fastapi.tiangolo.com",
    kind: "docs",
  },
  {
    name: "Python.org Official Site",
    url: "https://www.python.org",
    kind: "website",
  },
];

export default function WorkspacePage() {
  const { conversationId } = useParams();
  const convId = conversationId ? Number(conversationId) : null;
  const nav = useNavigate();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const createdRef = useRef<number | null>(null);

  // External integrations state (GitHub + Websites)
  const ghStatus = useAsync(() => githubApi.status(), []);
  const websites = useAsync(() => websitesApi.list(), []);
  const [connectorModal, setConnectorModal] = useState<"github" | "website" | null>(null);
  const [ghInput, setGhInput] = useState("https://github.com/Mahirlokare/devpilot-mcp-platform");
  const [ghToken, setGhToken] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteKind, setSiteKind] = useState<WebsiteKind>("website");
  const [siteToken, setSiteToken] = useState("");
  const [connBusy, setConnBusy] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  const convs = useAsync(() => conversationsApi.list(projectId), [projectId]);

  const loadDetail = useCallback(async (id: number, silent = false) => {
    if (!silent) setDetailLoading(true);
    try {
      const d = await conversationsApi.get(id);
      setDetail(d);
      setDetailError(null);
    } catch (e) {
      setDetailError(errorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (convId !== null && createdRef.current === convId) {
      createdRef.current = null;
      return;
    }
    setDetail(null);
    setActiveRunId(null);
    setDetailError(null);
    if (convId !== null) void loadDetail(convId);
  }, [convId, loadDetail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length, activeRunId]);

  async function sendText(rawText: string) {
    const content = rawText.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      let id = convId;
      if (id === null) {
        const c = await conversationsApi.create({ project_id: projectId, title: content.slice(0, 60) });
        id = c.id;
        createdRef.current = id;
        convs.reload();
        nav(`/workspace/${id}`);
      }
      const run = await conversationsApi.send(id, content);
      setDraft("");
      setActiveRunId(run.id);
      await loadDetail(id, true);
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    await sendText(draft);
  }

  async function removeConversation(id: number) {
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await conversationsApi.remove(id);
      convs.reload();
      if (id === convId) nav("/workspace");
    } catch (e) {
      setSendError(errorMessage(e));
    }
  }

  async function handleConnectGithub(e: FormEvent) {
    e.preventDefault();
    setConnBusy(true);
    setConnError(null);
    try {
      await githubApi.connect({
        username_or_repo: ghInput.trim() || "Mahirlokare/devpilot-mcp-platform",
        token: ghToken.trim() || null,
      });
      setGhToken("");
      setConnectorModal(null);
      ghStatus.reload();
    } catch (err) {
      setConnError(errorMessage(err));
    } finally {
      setConnBusy(false);
    }
  }

  async function handleConnectWebsite(e: FormEvent) {
    e.preventDefault();
    if (!siteUrl.trim()) return;
    setConnBusy(true);
    setConnError(null);
    try {
      let derivedName = siteName.trim();
      if (!derivedName) {
        try {
          const u = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`);
          derivedName = u.hostname.replace(/^www\./, "");
        } catch {
          derivedName = siteUrl.trim().slice(0, 40);
        }
      }
      await websitesApi.connect({
        name: derivedName,
        url: siteUrl.trim(),
        kind: siteKind,
        auth_token: siteToken.trim() || null,
      });
      setSiteName("");
      setSiteUrl("");
      setSiteToken("");
      setConnectorModal(null);
      websites.reload();
    } catch (err) {
      setConnError(errorMessage(err));
    } finally {
      setConnBusy(false);
    }
  }

  async function handleQuickPreset(preset: { name: string; url: string; kind: WebsiteKind }) {
    setConnBusy(true);
    setConnError(null);
    try {
      if (preset.kind === "github") {
        await githubApi.connect({ username_or_repo: preset.url });
        ghStatus.reload();
      }
      await websitesApi.connect({ name: preset.name, url: preset.url, kind: preset.kind });
      setConnectorModal(null);
      websites.reload();
    } catch (err) {
      setConnError(errorMessage(err));
    } finally {
      setConnBusy(false);
    }
  }

  async function handleDisconnectWebsite(id: number) {
    try {
      await websitesApi.disconnect(id);
      websites.reload();
    } catch (err) {
      setSendError(errorMessage(err));
    }
  }

  function promptForWebsite(w: { name: string; url: string; kind: string }) {
    if (w.kind === "github" || w.url.includes("github.com/")) {
      return `Inspect GitHub repository ${w.url} and summarize its structure and recent commits`;
    }
    if (w.kind === "openapi" || w.url.includes("openapi") || w.url.includes("swagger")) {
      return `Fetch and summarize the OpenAPI specification at ${w.url}`;
    }
    return `Fetch and analyze live website ${w.url} (${w.name}) and summarize its key information`;
  }

  const messages = detail?.messages ?? [];
  const runIds = Array.from(new Set(messages.map((m) => m.run_id).filter((r): r is number => r !== null)));
  const lastRunId = runIds[runIds.length - 1] ?? null;
  const shownRuns = new Set<number>();
  const settled = () => {
    if (convId !== null) void loadDetail(convId, true);
  };

  const ghConnected = ghStatus.data?.connected === true;
  const ghRepo = ghStatus.data?.default_repo || (ghStatus.data?.login ? `${ghStatus.data.login}/devpilot-mcp-platform` : "Mahirlokare/devpilot-mcp-platform");
  const connectedSites = websites.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="AI Developer Workspace"
        subtitle="Connect GitHub repositories & external websites, or describe any engineering goal in natural language."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConnError(null);
                setConnectorModal(connectorModal === "github" ? null : "github");
              }}
              className={`btn btn-sm ${ghConnected ? "border-emerald-500/40 text-emerald-300" : "btn-primary"}`}
            >
              {ghConnected ? `● GitHub: @${ghStatus.data?.login ?? "connected"}` : "+ Connect GitHub"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConnError(null);
                setConnectorModal(connectorModal === "website" ? null : "website");
              }}
              className="btn btn-primary btn-sm"
            >
              + Connect Website / API
            </button>
          </div>
        }
      />

      {/* Expandable Connector Drawer for GitHub & External Websites */}
      {connectorModal && (
        <div className="card mb-5 border-teal-500/40 bg-gradient-to-br from-bg-panel via-bg-panel to-teal-500/10 p-5 shadow-glow">
          <div className="mb-4 flex items-center justify-between border-b border-bg-border/75 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/20 text-sm font-bold text-teal-300 ring-1 ring-teal-500/40">
                {connectorModal === "github" ? "⌘" : "🌐"}
              </span>
              <div>
                <h2 className="font-display text-base font-bold">
                  {connectorModal === "github"
                    ? "Connect GitHub Account or Repository"
                    : "Connect External Website, Documentation, or API"}
                </h2>
                <p className="text-xs text-slate-400">
                  {connectorModal === "github"
                    ? "DevPilot will access repositories, files, commits, branches, issues, and PRs directly through the GitHub MCP server."
                    : "DevPilot will fetch live content, OpenAPI specs, headings, and JSON responses directly through the SSRF-guarded Web/APIDocs MCP server."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConnectorModal("github")}
                className={`btn btn-sm ${connectorModal === "github" ? "btn-primary" : ""}`}
              >
                GitHub
              </button>
              <button
                type="button"
                onClick={() => setConnectorModal("website")}
                className={`btn btn-sm ${connectorModal === "website" ? "btn-primary" : ""}`}
              >
                External Websites
              </button>
              <button
                type="button"
                onClick={() => setConnectorModal(null)}
                className="btn btn-sm"
                aria-label="Close connector"
              >
                ✕
              </button>
            </div>
          </div>

          {connError && (
            <div className="mb-4">
              <ErrorBox message={connError} />
            </div>
          )}

          {connectorModal === "github" ? (
            <form onSubmit={handleConnectGithub} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="GitHub Repository URL or Username"
                  hint="Works immediately for any public GitHub repo or account (no token required)."
                >
                  <input
                    className="input font-mono text-xs"
                    placeholder="https://github.com/Mahirlokare/devpilot-mcp-platform"
                    value={ghInput}
                    onChange={(e) => setGhInput(e.target.value)}
                  />
                </Field>
                <Field
                  label="Personal Access Token (Optional)"
                  hint="Provide a ghp_... or github_pat_... token for private repos & write operations."
                >
                  <input
                    className="input font-mono text-xs"
                    type="password"
                    placeholder="ghp_•••••••••••••••••••• (optional for public repos)"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-primary btn-sm" disabled={connBusy} type="submit">
                    {connBusy && <Spinner />} Connect GitHub to DevPilot
                  </button>
                  {ghConnected && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setConnectorModal(null);
                        void sendText(`Inspect GitHub repository ${ghRepo} and list recent commits`);
                      }}
                    >
                      Inspect @{ghStatus.data?.login} Repo Now →
                    </button>
                  )}
                </div>
                <Link to="/github" className="text-xs font-medium text-teal-400 hover:underline">
                  Open full GitHub Explorer →
                </Link>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <span className="label">1-Click Popular Website & API Presets</span>
                <div className="flex flex-wrap gap-2">
                  {WEBSITE_PRESETS.map((p) => (
                    <button
                      key={p.url}
                      type="button"
                      disabled={connBusy}
                      onClick={() => void handleQuickPreset(p)}
                      className="btn btn-sm"
                    >
                      + {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleConnectWebsite} className="grid gap-3 sm:grid-cols-4">
                <Field label="Website / Service Name">
                  <input
                    className="input"
                    placeholder="e.g. Stripe Docs or My Live App"
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                  />
                </Field>
                <Field label="Website or Endpoint URL">
                  <input
                    className="input font-mono text-xs"
                    required
                    placeholder="https://example.com or https://api.example.com"
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                  />
                </Field>
                <Field label="Source Type">
                  <select
                    className="input"
                    value={siteKind}
                    onChange={(e) => setSiteKind(e.target.value as WebsiteKind)}
                  >
                    <option value="website">Live Website / HTML Page</option>
                    <option value="rest_api">JSON / REST API Endpoint</option>
                    <option value="openapi">OpenAPI / Swagger Spec</option>
                    <option value="docs">Documentation Portal</option>
                    <option value="github">GitHub Repository URL</option>
                  </select>
                </Field>
                <Field label="Bearer / API Key (Optional)">
                  <div className="flex gap-2">
                    <input
                      className="input font-mono text-xs"
                      type="password"
                      placeholder="Optional auth token"
                      value={siteToken}
                      onChange={(e) => setSiteToken(e.target.value)}
                    />
                    <button className="btn btn-primary shrink-0" disabled={connBusy || !siteUrl.trim()} type="submit">
                      {connBusy ? <Spinner /> : "Connect"}
                    </button>
                  </div>
                </Field>
              </form>
            </div>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[18rem_1fr]">
        <aside className="card flex min-h-0 flex-col p-4">
          <div className="mb-3 space-y-2.5">
            <ProjectSelect value={projectId} onChange={setProjectId} noneLabel="All / default workspace" />
            <button className="btn btn-primary w-full" onClick={() => nav("/workspace")}>
              + New conversation
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pt-1">
            <Async loading={convs.loading} error={convs.error} onRetry={convs.reload}>
              {(convs.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No conversations yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(convs.data ?? []).map((c) => (
                    <li
                      key={c.id}
                      className={`group flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition ${
                        c.id === convId
                          ? "bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/30"
                          : "hover:bg-bg-raised/80"
                      }`}
                    >
                      <button className="min-w-0 flex-1 text-left" onClick={() => nav(`/workspace/${c.id}`)}>
                        <span className="block truncate font-medium">{c.title || `Conversation ${c.id}`}</span>
                        <span className="block text-[11px] text-slate-500">{fmtDate(c.created_at)}</span>
                      </button>
                      <button
                        className="rounded p-1 text-xs text-slate-500 opacity-70 hover:bg-rose-500/15 hover:text-rose-300 group-hover:opacity-100"
                        aria-label={`Delete conversation ${c.id}`}
                        onClick={() => void removeConversation(c.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </div>
        </aside>

        <section className="card flex min-h-[65vh] min-w-0 flex-col">
          {/* Connected Sources Live Access Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bg-border/75 bg-bg-raised/35 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Connected Sources:
              </span>

              {ghConnected ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="font-medium">GitHub @{ghStatus.data?.login}</span>
                  <button
                    type="button"
                    onClick={() =>
                      void sendText(`Inspect GitHub repository ${ghRepo} and summarize its files and recent commits`)
                    }
                    className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/35"
                    title={`Query ${ghRepo} live`}
                  >
                    Access Live →
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConnectorModal("github")}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-teal-500/40 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-300 hover:bg-teal-500/20"
                >
                  + Connect GitHub
                </button>
              )}

              {connectedSites.map((w) => (
                <div
                  key={w.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/35 bg-teal-500/10 px-2.5 py-0.5 text-xs text-teal-300"
                >
                  <span className="font-medium">{w.name}</span>
                  <button
                    type="button"
                    onClick={() => void sendText(promptForWebsite(w))}
                    className="rounded bg-teal-500/20 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-teal-200 hover:bg-teal-500/35"
                    title={`Fetch ${w.url} live via MCP`}
                  >
                    Access Live →
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDisconnectWebsite(w.id)}
                    className="text-[10px] text-slate-400 hover:text-rose-300"
                    title="Disconnect website"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setConnectorModal("website")}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-bg-border bg-bg/60 px-2.5 py-0.5 text-xs text-slate-300 hover:border-teal-500/40 hover:text-teal-300"
              >
                + Add Website / URL
              </button>
            </div>

            <Badge tone="info">7 MCP Servers Ready</Badge>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {convId === null && !activeRunId && (
              <div className="space-y-4 py-4">
                <EmptyState>
                  <p className="font-display text-base font-semibold text-slate-200">
                    What would you like DevPilot to investigate, build, or access live?
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Connect GitHub or any external website above, choose a starter prompt below, or paste any URL directly in the composer.
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConnectorModal("github")}
                      className="btn btn-primary btn-sm"
                    >
                      ⌘ Connect GitHub Repository
                    </button>
                    <button
                      type="button"
                      onClick={() => setConnectorModal("website")}
                      className="btn btn-sm"
                    >
                      🌐 Connect External Website / API
                    </button>
                  </div>
                </EmptyState>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {SUGGESTED_PROMPTS.map((item) => (
                    <button
                      key={item.prompt}
                      type="button"
                      onClick={() => setDraft(item.prompt)}
                      className="group rounded-xl border border-bg-border bg-bg/60 p-3.5 text-left text-xs text-slate-300 transition hover:-translate-y-0.5 hover:border-teal-500/45 hover:bg-bg-raised/70"
                    >
                      <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-teal-400">
                        {item.tag}
                      </span>
                      <span className="leading-relaxed">{item.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {detailLoading && <Loading />}
            {detailError && <ErrorBox message={detailError} onRetry={() => convId !== null && void loadDetail(convId)} />}
            {messages.map((m) => {
              const showRun = m.run_id !== null && !shownRuns.has(m.run_id);
              if (m.run_id !== null) shownRuns.add(m.run_id);
              return (
                <div key={m.id} className="space-y-3">
                  <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "border border-teal-500/30 bg-teal-500/15 text-slate-100"
                          : "border border-bg-border/80 bg-bg-raised/85 text-slate-200"
                      }`}
                    >
                      <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-teal-400">
                        {m.role === "user" ? "Developer" : "DevPilot Assistant"}
                      </p>
                      {m.content}
                    </div>
                  </div>
                  {showRun && m.run_id !== null && (
                    <RunPanel runId={m.run_id} defaultOpen={m.run_id === activeRunId || m.run_id === lastRunId} onSettled={settled} />
                  )}
                </div>
              );
            })}
            {activeRunId !== null && !shownRuns.has(activeRunId) && <RunPanel runId={activeRunId} onSettled={settled} />}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="rounded-b-2xl border-t border-bg-border/70 bg-bg/40 p-4">
            {sendError && (
              <div className="mb-3">
                <ErrorBox message={sendError} />
              </div>
            )}
            <div className="flex gap-3">
              <textarea
                className="input h-20 resize-none"
                placeholder="Ask DevPilot to analyze code, inspect a GitHub URL (https://github.com/owner/repo), fetch any live website (https://...), query your database, or run tests… (Enter to send)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(e as unknown as FormEvent);
                  }
                }}
              />
              <button className="btn btn-primary self-end px-5 py-2.5" disabled={sending || !draft.trim()} type="submit">
                {sending ? <Spinner /> : "Send"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
