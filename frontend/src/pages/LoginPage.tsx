import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { ErrorBox, Field, Spinner } from "../components/ui";

const PLATFORM_HIGHLIGHTS = [
  {
    badge: "7 MCP Servers • 43 Tools",
    title: "Unified Model Context Protocol Hub",
    desc: "Isolated FastMCP servers for Filesystem, GitHub, SQL Database, Terminal, Testing, Docker Deployment, and OpenAPI Docs.",
  },
  {
    badge: "11-Stage Security Gateway",
    title: "Defense-in-Depth Policy Engine",
    desc: "RBAC role checks, workspace path confinement, SQL read-only AST guards, executable allowlists, and secret scrubbing.",
  },
  {
    badge: "Human-in-the-Loop",
    title: "Auditable AI Orchestration",
    desc: "High-risk & destructive tool invocations automatically pause in the Approvals Queue with full execution telemetry.",
  },
];

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const cfg = useAsync(() => authApi.config(), []);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={(loc.state as { from?: string } | null)?.from ?? "/"} replace />;

  const redirectTarget = (loc.state as { from?: string } | null)?.from ?? "/";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
      nav(redirectTarget, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function quickDemoSignIn() {
    setError(null);
    setUsername("admin_pilot");
    setPassword("StrongPassword123!");
    setBusy(true);
    try {
      await login("admin_pilot", "StrongPassword123!");
      nav(redirectTarget, { replace: true });
    } catch {
      try {
        await register("admin_pilot", "StrongPassword123!");
        nav(redirectTarget, { replace: true });
      } catch (err) {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const registrationOpen = cfg.data?.registration_open !== false;

  return (
    <div className="flex min-h-full items-center justify-center p-4 sm:p-6 lg:p-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-bg-border/85 bg-bg-panel/90 shadow-glow backdrop-blur-xl lg:grid-cols-[1.15fr_1fr]">
        {/* Left Enterprise Showcase Column */}
        <div className="relative hidden flex-col justify-between border-r border-bg-border/75 bg-gradient-to-br from-teal-500/12 via-bg-panel to-cyan-500/10 p-8 lg:flex">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/35 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-300">
              <span className="h-2 w-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.9)]" />
              Model Context Protocol • JSON-RPC 2.0
            </div>
            <h2 className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight">
              Enterprise AI Engineering Control Plane
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
              Orchestrate natural-language engineering workflows across isolated MCP servers with strict policy enforcement, RBAC governance, and real-time telemetry.
            </p>

            <div className="mt-6 space-y-3.5">
              {PLATFORM_HIGHLIGHTS.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-bg-border/80 bg-bg/60 p-4 transition hover:border-teal-500/35"
                >
                  <span className="inline-block rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-teal-300">
                    {item.badge}
                  </span>
                  <h3 className="mt-1.5 font-display text-sm font-semibold">{item.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-bg-border/70 pt-4 text-xs text-slate-400">
            <span className="font-mono">FastAPI • React 18 • TypeScript • Docker</span>
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-teal-400 hover:text-teal-300 hover:underline"
            >
              OpenAPI Swagger ↗
            </a>
          </div>
        </div>

        {/* Right Authentication Form Column */}
        <div className="flex flex-col justify-center p-6 sm:p-8 lg:p-10">
          <div className="mb-6 text-center lg:text-left">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 via-teal-500 to-cyan-600 text-2xl font-bold text-white shadow-[0_4px_16px_rgba(20,184,166,0.35)] lg:mx-0">
              ◆
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight">DevPilot</h1>
            <p className="mt-1 text-sm text-slate-400">
              {mode === "login" ? "Sign in to your AI developer workspace" : "Create your developer account"}
            </p>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-1.5 rounded-xl border border-bg-border bg-bg/75 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                mode === "login"
                  ? "bg-teal-500/20 text-teal-300 shadow-xs ring-1 ring-teal-500/35"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              disabled={!registrationOpen}
              onClick={() => {
                setMode("register");
                setError(null);
              }}
              className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                mode === "register"
                  ? "bg-teal-500/20 text-teal-300 shadow-xs ring-1 ring-teal-500/35"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Username">
              <input
                className="input"
                autoComplete="username"
                placeholder="e.g. admin_pilot"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="Password" hint={mode === "register" ? "At least 10 characters." : undefined}>
              <input
                className="input"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <ErrorBox message={error} />}
            <button className="btn btn-primary w-full py-2.5" disabled={busy} type="submit">
              {busy && <Spinner />} {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="mt-5 rounded-2xl border border-teal-500/35 bg-gradient-to-r from-teal-500/12 to-cyan-500/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div>
                <p className="text-xs font-semibold text-teal-300">Instant Demo Admin Access</p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-300">
                  User: <strong>admin_pilot</strong> · Pass: <strong>StrongPassword123!</strong>
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void quickDemoSignIn()}
                className="btn btn-primary btn-sm shrink-0"
              >
                1-Click Sign In
              </button>
            </div>
          </div>

          <div className="mt-4 text-center text-sm text-slate-400">
            {cfg.loading ? null : cfg.error ? (
              <p className="text-xs text-amber-300">Could not reach the API ({cfg.error}).</p>
            ) : (
              <button
                type="button"
                className="text-xs font-medium text-teal-400 transition hover:text-teal-300 hover:underline"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError(null);
                }}
              >
                {mode === "login" ? "Need a new account? Create one here" : "Already have an account? Sign in"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
