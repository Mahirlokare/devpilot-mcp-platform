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
      nav((loc.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const registrationOpen = cfg.data?.registration_open === true;

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 text-center">
          <div className="text-3xl text-sky-400">◆</div>
          <h1 className="mt-1 text-xl font-semibold">DevPilot</h1>
          <p className="text-sm text-slate-400">{mode === "login" ? "Sign in to your workspace" : "Create an account"}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <input className="input" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password" hint={mode === "register" ? "At least 10 characters." : undefined}>
            <input
              className="input"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <ErrorBox message={error} />}
          <button className="btn btn-primary w-full" disabled={busy} type="submit">
            {busy && <Spinner />} {mode === "login" ? "Sign in" : "Register"}
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-slate-400">
          {cfg.loading ? null : cfg.error ? (
            <p className="text-xs text-amber-300">Could not reach the API ({cfg.error}).</p>
          ) : registrationOpen ? (
            <button className="underline hover:text-slate-200" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
              {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
            </button>
          ) : (
            <p className="text-xs">Registration is closed. Ask an administrator for an account.</p>
          )}
        </div>
      </div>
    </div>
  );
}
