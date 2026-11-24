import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi } from "../api/endpoints";
import { getToken, setToken, setUnauthorizedHandler } from "../api/client";
import type { Role, User } from "../api/types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => void;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getToken());

  useEffect(() => {
    // Central 401 handling: drop the session; ProtectedRoute redirects to /login.
    const restore = setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      setLoading(false);
    });
    return restore;
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    authApi
      .me()
      .then((u) => !cancelled && setUser(u))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const r = await authApi.login(u, p);
    setUser(r.user);
  }, []);
  const register = useCallback(async (u: string, p: string) => {
    const r = await authApi.register(u, p);
    setUser(r.user);
  }, []);
  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);
  const can = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user]);

  const value = useMemo(() => ({ user, loading, login, register, logout, can }), [user, loading, login, register, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
