import { useState, type FormEvent } from "react";
import { projectsApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Project } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { fmtDate } from "../lib/format";
import { Async, Card, EmptyState, ErrorBox, Field, PageHeader } from "../components/ui";

function ProjectForm({ initial, onSaved, onCancel }: { initial?: Project; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [repo, setRepo] = useState(initial?.repo_full_name ?? "");
  const [root, setRoot] = useState(initial?.root_path ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), description: description.trim(), repo_full_name: repo.trim() || null, root_path: root.trim() || null };
    try {
      if (initial) await projectsApi.update(initial.id, body);
      else await projectsApi.create(body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea className="input h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="GitHub repo" hint="owner/name">
          <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
        </Field>
        <Field label="Root path" hint="Filesystem root the tools are jailed to">
          <input className="input" value={root} onChange={(e) => setRoot(e.target.value)} />
        </Field>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy} type="submit">
          {initial ? "Save changes" : "Create project"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MemoryPanel({ project }: { project: Project }) {
  const mem = useAsync(() => projectsApi.memory(project.id), [project.id]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await projectsApi.addMemory(project.id, text.trim());
      setText("");
      mem.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function remove(id: number) {
    setError(null);
    try {
      await projectsApi.removeMemory(project.id, id);
      mem.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex gap-2">
        <input className="input" placeholder="Add a project note / memory…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary" type="submit">
          Add
        </button>
      </form>
      {error && <ErrorBox message={error} />}
      <Async loading={mem.loading} error={mem.error} onRetry={mem.reload}>
        {(mem.data ?? []).length === 0 ? (
          <EmptyState>No memory entries for this project.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {(mem.data ?? []).map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2 rounded border border-bg-border bg-bg p-2 text-sm">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p className="text-xs text-slate-500">{fmtDate(m.created_at)}</p>
                </div>
                <button className="btn btn-sm" onClick={() => void remove(m.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}

export default function ProjectsPage() {
  const { can } = useAuth();
  const canEdit = can("admin", "developer");
  const projects = useAsync(() => projectsApi.list(), []);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [selected, setSelected] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(p: Project) {
    if (!window.confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await projectsApi.remove(p.id);
      if (selected?.id === p.id) setSelected(null);
      projects.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Projects scope conversations, filesystem access and memory."
        actions={canEdit && <button className="btn btn-primary" onClick={() => setEditing("new")}>+ New project</button>}
      />
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {editing && (
        <div className="mb-4">
          <Card title={editing === "new" ? "New project" : `Edit ${editing.name}`}>
            <ProjectForm
              initial={editing === "new" ? undefined : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                projects.reload();
                setSelected(null);
              }}
            />
          </Card>
        </div>
      )}
      <Async loading={projects.loading} error={projects.error} onRetry={projects.reload}>
        {(projects.data ?? []).length === 0 ? (
          <EmptyState>No projects yet.</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {(projects.data ?? []).map((p) => (
                <div key={p.id} className={`card p-3 ${selected?.id === p.id ? "border-sky-500" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="min-w-0 text-left" onClick={() => setSelected(p)}>
                      <p className="font-semibold">{p.name}</p>
                      <p className="whitespace-pre-wrap break-words text-sm text-slate-400">{p.description || "No description"}</p>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {p.repo_full_name ?? "no repo"} · {p.root_path ?? "no root path"}
                      </p>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button className="btn btn-sm" onClick={() => setSelected(p)}>Memory</button>
                      {canEdit && <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>}
                      {canEdit && <button className="btn btn-danger btn-sm" onClick={() => void remove(p)}>Delete</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div>
              {selected ? (
                <Card title={`Memory — ${selected.name}`}>
                  <MemoryPanel project={selected} />
                </Card>
              ) : (
                <EmptyState>Select a project to view its memory.</EmptyState>
              )}
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}
