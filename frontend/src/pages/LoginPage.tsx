import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { ErrorBox, Field, Spinner } from "../components/ui";

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
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 shadow-glow">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-2xl font-bold text-white shadow-md">
            ◆
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">DevPilot</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {mode === "login" ? "Sign in to your AI developer workspace" : "Create your developer account"}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1.5 rounded-xl border border-bg-border bg-bg/70 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`rounded-lg py-1.5 text-xs font-semibold transition ${
              mode === "login" ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-500/30" : "text-slate-400 hover:text-slate-200"
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
              mode === "register" ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-500/30" : "text-slate-400 hover:text-slate-200"
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

        <div className="mt-5 rounded-xl border border-teal-500/30 bg-teal-500/10 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-teal-300">Ready-to-Use Admin Account</p>
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
  );
}
