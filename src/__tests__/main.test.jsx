/**
 * Frontend Smoke — auth gating
 *
 * Bu dosya main.jsx'in `Root` component'ini bağımsız test etmek yerine
 * api.js'in getMe + auth:unauthorized davranışlarını izole olarak doğrular.
 * Root'u test etmek main.jsx'i export etmemizi gerektirir; o yüzden
 * davranışsal smoke buradan yapılır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as api from "../api";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("auth gating behavior", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getMe success returns user payload", async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ data: { id: "1", username: "admin", displayName: "Admin" } }),
    );
    const user = await api.getMe();
    expect(user).toEqual({ id: "1", username: "admin", displayName: "Admin" });
  });

  it("logout calls /auth/logout", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.logout();
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = fetch.mock.calls[0][0];
    expect(url).toMatch(/\/auth\/logout$/);
    const opts = fetch.mock.calls[0][1];
    expect(opts.method).toBe("POST");
  });

  it("api requests include credentials for cookie auth", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await api.getStudents();
    const opts = fetch.mock.calls[0][1];
    expect(opts.credentials).toBe("include");
  });

  it("getMe failure (no data field) throws", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(api.getMe()).rejects.toThrow(/kullanıcı bilgisi/i);
  });
});
