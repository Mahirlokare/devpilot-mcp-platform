import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { conversationsApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { ConversationDetail } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { fmtDate } from "../lib/format";
import { ProjectSelect } from "../components/ProjectSelect";
import { RunPanel } from "../components/RunPanel";
import { Async, EmptyState, ErrorBox, Loading, PageHeader, Spinner } from "../components/ui";

const SUGGESTED_PROMPTS = [
  "Explain the project architecture and scan for security vulnerabilities",
  "Inspect the database tables and generate schema documentation",
  "Detect test frameworks and run the pytest test suite",
  "Find duplicate code blocks across the workspace",
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

  const messages = detail?.messages ?? [];
  const runIds = Array.from(new Set(messages.map((m) => m.run_id).filter((r): r is number => r !== null)));
  const lastRunId = runIds[runIds.length - 1] ?? null;
  const shownRuns = new Set<number>();
  const settled = () => {
    if (convId !== null) void loadDetail(convId, true);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="AI Developer Workspace"
        subtitle="Describe your engineering goal in natural language. DevPilot plans and executes across isolated MCP tools."
      />
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
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {convId === null && !activeRunId && (
              <div className="space-y-4 py-6">
                <EmptyState>
                  <p className="font-display text-base font-semibold text-slate-200">What would you like DevPilot to investigate or build?</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Choose a starter prompt below or type any instruction in the composer.
                  </p>
                </EmptyState>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDraft(p)}
                      className="rounded-xl border border-bg-border bg-bg/60 p-3.5 text-left text-xs text-slate-300 transition hover:border-teal-500/40 hover:bg-bg-raised/70"
                    >
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-teal-400">Starter Prompt</span>
                      {p}
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

          <form onSubmit={send} className="border-t border-bg-border/70 bg-bg/40 p-4 rounded-b-2xl">
            {sendError && (
              <div className="mb-3">
                <ErrorBox message={sendError} />
              </div>
            )}
            <div className="flex gap-3">
              <textarea
                className="input h-20 resize-none"
                placeholder="Ask DevPilot to analyze code, query your database, run tests, or inspect deployments… (Enter to send)"
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
