import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { approvalsApi, healthApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { Loading } from "./ui";

type NavItem = { to: string; label: string; group: "Workspace" | "Ecosystem" | "Engineering" | "Governance"; icon: ReactNode };

const ICONS = {
  dashboard: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  workspace: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
      <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z" />
    </svg>
  ),
  projects: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  ),
  github: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M6 8.5v7M18 8.5a6 6 0 01-6 6H6" />
    </svg>
  ),
  mcp: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
      <circle cx="7" cy="17" r="1" fill="currentColor" />
    </svg>
  ),
  tools: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 00-5.4 5.4l-6 6a1.5 1.5 0 002.1 2.1l6-6a4 4 0 005.4-5.4l-2.6 2.6-2.1-2.1 2.6-2.6z" />
    </svg>
  ),
  database: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  ),
  analysis: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  ),
  testing: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4" />
      <path d="M12 3l8 4v5c0 5.25-3.4 9.75-8 11-4.6-1.25-8-5.75-8-11V7l8-4z" />
    </svg>
  ),
  deployments: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L4.5 20.3l.7.7L12 18l6.8 3 .7-.7L12 2z" />
    </svg>
  ),
  history: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  approvals: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  ),
  usage: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  ),
  settings: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", group: "Workspace", icon: ICONS.dashboard },
  { to: "/workspace", label: "AI Workspace", group: "Workspace", icon: ICONS.workspace },
  { to: "/projects", label: "Projects", group: "Workspace", icon: ICONS.projects },
  { to: "/mcp", label: "MCP Servers", group: "Ecosystem", icon: ICONS.mcp },
  { to: "/tools", label: "Tool Explorer", group: "Ecosystem", icon: ICONS.tools },
  { to: "/github", label: "GitHub", group: "Ecosystem", icon: ICONS.github },
  { to: "/database", label: "Database", group: "Engineering", icon: ICONS.database },
  { to: "/analysis", label: "Code Analysis", group: "Engineering", icon: ICONS.analysis },
  { to: "/testing", label: "Testing", group: "Engineering", icon: ICONS.testing },
  { to: "/deployments", label: "Deployments", group: "Engineering", icon: ICONS.deployments },
  { to: "/approvals", label: "Approvals", group: "Governance", icon: ICONS.approvals },
  { to: "/history", label: "History", group: "Governance", icon: ICONS.history },
  { to: "/usage", label: "Usage & Audit", group: "Governance", icon: ICONS.usage },
  { to: "/settings", label: "Settings", group: "Governance", icon: ICONS.settings },
];

const GROUPS: NavItem["group"][] = ["Workspace", "Ecosystem", "Engineering", "Governance"];

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Checking session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Layout />;
}

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = window.localStorage.getItem("devpilot_theme");
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    window.localStorage.setItem("devpilot_theme", theme);
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}

function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const health = useAsync(() => healthApi.get(), [loc.pathname]);
  const pendingApprovals = useAsync(() => approvalsApi.list("pending"), [loc.pathname]);
  const pendingCount = (pendingApprovals.data ?? []).length;

  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-xs md:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-bg-border/80 bg-bg-panel/95 backdrop-blur-md transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-bg-border/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-sm">
              <span className="text-base font-bold">◆</span>
            </div>
            <div>
              <span className="block font-display text-base font-bold tracking-tight">DevPilot</span>
              <span className="block text-[11px] font-medium text-teal-400">MCP AI Platform</span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            title={theme === "dark" ? "Switch to Calm Daylight theme" : "Switch to Soothing Twilight theme"}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-bg-border bg-bg-raised/70 text-slate-400 transition hover:border-teal-500/40 hover:text-teal-400"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Main">
          {GROUPS.map((grp) => (
            <div key={grp}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{grp}</p>
              <div className="space-y-0.5">
                {NAV.filter((n) => n.group === grp).map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === "/"}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `group flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                        isActive
                          ? "bg-teal-500/15 text-teal-400 shadow-xs ring-1 ring-teal-500/30"
                          : "text-slate-400 hover:bg-bg-raised/80 hover:text-slate-200"
                      }`
                    }
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="opacity-80 group-hover:opacity-100">{n.icon}</span>
                      <span>{n.label}</span>
                    </span>
                    {n.to === "/approvals" && pendingCount > 0 && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/40">
                        {pendingCount}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-bg-border/70 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-bg-border/70 bg-bg/60 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 font-display text-xs font-bold uppercase text-teal-400 ring-1 ring-teal-500/30">
              {(user?.username ?? "U").slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-200">{user?.username}</p>
              <p className="text-[11px] capitalize text-teal-400">{user?.role}</p>
            </div>
            <span
              title={health.error ? "API unreachable" : "API healthy"}
              className={`h-2 w-2 rounded-full ${health.error ? "bg-rose-400" : "bg-emerald-400"}`}
            />
          </div>
          <button className="btn btn-sm w-full" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-bg-border bg-bg-panel/90 px-4 py-3 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-2.5">
            <button className="btn btn-sm" aria-label="Open menu" onClick={() => setOpen(true)}>
              ☰
            </button>
            <span className="font-display font-bold">DevPilot</span>
          </div>
          <button className="btn btn-sm" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? "☀ Daylight" : "☾ Twilight"}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-7">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
