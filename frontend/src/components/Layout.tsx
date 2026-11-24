import { useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Loading } from "./ui";

const NAV: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Dashboard", icon: "▦" },
  { to: "/workspace", label: "AI Workspace", icon: "✦" },
  { to: "/projects", label: "Projects", icon: "▤" },
  { to: "/github", label: "GitHub", icon: "⌥" },
  { to: "/mcp", label: "MCP Servers", icon: "⛁" },
  { to: "/tools", label: "Tool Explorer", icon: "⚒" },
  { to: "/database", label: "Database", icon: "▥" },
  { to: "/analysis", label: "Code Analysis", icon: "⌕" },
  { to: "/testing", label: "Testing", icon: "✓" },
  { to: "/deployments", label: "Deployments", icon: "⇪" },
  { to: "/history", label: "History", icon: "↺" },
  { to: "/approvals", label: "Approvals", icon: "⚑" },
  { to: "/usage", label: "Usage", icon: "▲" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Checking session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Layout />;
}

function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-bg-border bg-bg-panel transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-2 border-b border-bg-border px-4 py-3">
          <span className="text-lg text-sky-400">◆</span>
          <span className="font-semibold tracking-tight">DevPilot</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Main">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-sky-500/15 text-sky-300" : "text-slate-300 hover:bg-slate-700/40"}`
              }
            >
              <span className="w-4 text-center text-slate-500">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-bg-border p-3 text-xs">
          <p className="truncate font-medium text-slate-200">{user?.username}</p>
          <p className="mb-2 text-slate-500">{user?.role}</p>
          <button className="btn btn-sm w-full" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-bg-border bg-bg-panel px-3 py-2 md:hidden">
          <button className="btn btn-sm" aria-label="Open menu" onClick={() => setOpen(true)}>
            ☰
          </button>
          <span className="font-semibold">DevPilot</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
