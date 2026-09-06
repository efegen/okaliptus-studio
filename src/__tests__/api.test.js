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

  it("öğrenci silme etkisini kapsam endpoint'inden alır", async () => {
    const impact = {
      lessons: 1,
      eventParticipations: 2,
      noteMentions: 3,
      drivenVehicles: 1,
    };
    fetch.mockResolvedValueOnce(jsonResponse({ data: impact }));

    await expect(api.getStudentDeleteImpact("7/8")).resolves.toEqual(impact);
    expect(fetch.mock.calls[0][0]).toMatch(/\/students\/7%2F8\/delete-impact$/);
  });

  it("getMe throws when payload has no data", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(api.getMe()).rejects.toThrow(/kullanıcı bilgisi/i);
  });

  it("etkinlik katılımcısı arama ve kaldırma ayrıntılarını gönderir", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ data: { id: "9", last_contacted_at: "2026-09-06T10:00:00Z" } }))
      .mockResolvedValueOnce(jsonResponse({ data: null }));

    await api.markEventParticipantContacted("9", { note: "Tekrar aranacak" });
    await api.removeEventParticipant("9", { reason: "student_cancelled", note: "Programı değişti" });

    expect(fetch.mock.calls[0][0]).toMatch(/\/events\/participants\/9\/contact$/);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ note: "Tekrar aranacak" }),
    });
    expect(fetch.mock.calls[1][0]).toMatch(/\/events\/participants\/9$/);
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ reason: "student_cancelled", note: "Programı değişti" }),
    });
  });
});
