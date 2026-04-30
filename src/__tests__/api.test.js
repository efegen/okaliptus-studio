/**
 * Frontend Smoke — api.js (apiRequest behavior)
 *
 * - 401 response on protected path → dispatches `auth:unauthorized` event
 * - 401 response on /auth path → does NOT dispatch (login fail is expected)
 * - login() invokes /auth/login then /auth/me
 * - getStudents() throws on invalid response shape
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as api from "../api";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiRequest", () => {
  let unauthorizedSpy;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    unauthorizedSpy = vi.fn();
    window.addEventListener("auth:unauthorized", unauthorizedSpy);
  });

  afterEach(() => {
    window.removeEventListener("auth:unauthorized", unauthorizedSpy);
    vi.unstubAllGlobals();
  });

  it("dispatches auth:unauthorized on 401 from a protected endpoint", async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "UNAUTHORIZED", message: "x" } }, 401),
    );
    await expect(api.getStudents()).rejects.toThrow();
    expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT dispatch auth:unauthorized on 401 from /auth/* path", async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "UNAUTHORIZED", message: "x" } }, 401),
    );
    // getMe targets /auth/me; 401 should not echo to global handler.
    await expect(api.getMe()).rejects.toThrow();
    expect(unauthorizedSpy).not.toHaveBeenCalled();
  });

  it("login() POSTs /auth/login then GETs /auth/me", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: "1", username: "admin", displayName: "Admin" } }),
      );

    const user = await api.login("admin", "secret123");
    expect(user).toEqual({ id: "1", username: "admin", displayName: "Admin" });
    expect(fetch).toHaveBeenCalledTimes(2);

    const firstUrl = fetch.mock.calls[0][0];
    const secondUrl = fetch.mock.calls[1][0];
    expect(firstUrl).toMatch(/\/auth\/login$/);
    expect(secondUrl).toMatch(/\/auth\/me$/);
  });

  it("getStudents throws on invalid response shape", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ wrong: "shape" }));
    await expect(api.getStudents()).rejects.toThrow(/öğrenci listesi/i);
  });

  it("getMe throws when payload has no data", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(api.getMe()).rejects.toThrow(/kullanıcı bilgisi/i);
  });
});
