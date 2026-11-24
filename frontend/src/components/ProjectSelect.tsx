import { projectsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";

/** Project picker backed by the real project list. */
export function ProjectSelect({ value, onChange, allowNone = true, noneLabel = "(no project)" }: { value: number | null; onChange: (id: number | null) => void; allowNone?: boolean; noneLabel?: string }) {
  const { data, loading, error } = useAsync(() => projectsApi.list(), []);
  return (
    <div>
      <select
        className="input"
        aria-label="Project"
        value={value ?? ""}
        disabled={loading}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        {allowNone && <option value="">{noneLabel}</option>}
        {(data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-300">Could not load projects: {error}</p>}
      {!loading && !error && (data ?? []).length === 0 && <p className="mt-1 text-xs text-slate-500">No projects yet.</p>}
    </div>
  );
}
