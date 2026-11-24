import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  formatDetail,
  getToken,
  http,
  setToken,
  setUnauthorizedHandler,
} from "../api/client";

describe("API client & 401 handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setToken(null);
    setUnauthorizedHandler(null);
  });

  it("attaches Authorization Bearer header when token is present", async () => {
    setToken("jwt-secret-123");
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = mockFetch;

    const res = await http.get<{ status: string }>("/health");
    expect(res).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-secret-123");
  });

  it("clears token and invokes unauthorized handler on 401 when noAuthRedirect is false", async () => {
    setToken("expired-token");
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid token" }), { status: 401 }),
    );

    await expect(http.get("/auth/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
    expect(getToken()).toBeNull();
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it("does not invoke global unauthorized handler on 401 when noAuthRedirect is true (e.g. login)", async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Bad credentials" }), { status: 401 }),
    );

    await expect(
      http.post("/auth/login", { username: "u", password: "p" }, { noAuthRedirect: true }),
    ).rejects.toThrow(ApiError);
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it("formats FastAPI string and validation-list details accurately", () => {
    expect(formatDetail("Forbidden", "fallback")).toBe("Forbidden");
    expect(
      formatDetail(
        [
          { loc: ["body", "password"], msg: "String should have at least 10 characters" },
          { loc: ["username"], msg: "Field required" },
        ],
        "fallback",
      ),
    ).toBe("password: String should have at least 10 characters; username: Field required");
  });
});
