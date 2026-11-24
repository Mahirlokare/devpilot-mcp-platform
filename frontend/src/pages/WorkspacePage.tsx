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
      createdRef.current = null; // just created by send(); send() loads the detail itself
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

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
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
      <PageHeader title="AI Workspace" subtitle="Describe an objective; the agent calls MCP tools and reports every step." />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="card flex min-h-0 flex-col p-3">
          <div className="mb-2 space-y-2">
            <ProjectSelect value={projectId} onChange={setProjectId} noneLabel="All / no project" />
            <button className="btn btn-primary w-full" onClick={() => nav("/workspace")}>
              + New conversation
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Async loading={convs.loading} error={convs.error} onRetry={convs.reload}>
              {(convs.data ?? []).length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-500">No conversations yet.</p>
              ) : (
                <ul className="space-y-1">
                  {(convs.data ?? []).map((c) => (
                    <li key={c.id} className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${c.id === convId ? "bg-sky-500/15" : "hover:bg-slate-700/40"}`}>
                      <button className="min-w-0 flex-1 text-left" onClick={() => nav(`/workspace/${c.id}`)}>
                        <span className="block truncate">{c.title || `Conversation ${c.id}`}</span>
                        <span className="block text-xs text-slate-500">{fmtDate(c.created_at)}</span>
                      </button>
                      <button className="text-xs text-slate-500 hover:text-red-300" aria-label={`Delete conversation ${c.id}`} onClick={() => void removeConversation(c.id)}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </div>
        </aside>

        <section className="card flex min-h-[60vh] min-w-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {convId === null && !activeRunId && <EmptyState>Start a new conversation by typing an objective below.</EmptyState>}
            {detailLoading && <Loading />}
            {detailError && <ErrorBox message={detailError} onRetry={() => convId !== null && void loadDetail(convId)} />}
            {messages.map((m) => {
              const showRun = m.run_id !== null && !shownRuns.has(m.run_id);
              if (m.run_id !== null) shownRuns.add(m.run_id);
              return (
                <div key={m.id} className="space-y-2">
                  <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-sky-600/30" : "bg-bg-raised"}`}>
                      <p className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-500">{m.role}</p>
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
          <form onSubmit={send} className="border-t border-bg-border p-3">
            {sendError && (
              <div className="mb-2">
                <ErrorBox message={sendError} />
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                className="input h-20 resize-none"
                placeholder="What should DevPilot do? (Enter to send, Shift+Enter for newline)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(e as unknown as FormEvent);
                  }
                }}
              />
              <button className="btn btn-primary self-end" disabled={sending || !draft.trim()} type="submit">
                {sending ? <Spinner /> : "Send"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
