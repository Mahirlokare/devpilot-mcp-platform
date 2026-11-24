import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-bg-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="card-pad">{children}</div>
    </section>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400 ${className}`} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      <span className="whitespace-pre-wrap break-words">{message}</span>
      {onRetry && (
        <button className="btn btn-sm shrink-0" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-bg-border px-4 py-6 text-center text-sm text-slate-400">{children}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "success"; children: ReactNode }) {
  const c = {
    info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  }[tone];
  return <div className={`rounded-md border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Wrapper that shows loading / error / content for an AsyncState-like triple. */
export function Async({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={onRetry} />;
  return <>{children}</>;
}
