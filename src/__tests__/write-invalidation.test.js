/**
 * Başarılı yazmadan sonra merkezi önbellek tazeleme (hooks/writeInvalidation.js).
 *
 * Asıl senaryo: takvimdeki ders kartından tahsilat yapılınca öğrenci profili,
 * borçlular ve hareketler de tazelenmeli — eskiden yalnız haftanın dersleri
 * tazeleniyordu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { queryKeysForWrite, invalidateAfterWrite } from "../hooks/writeInvalidation";
import { queryClient as appQueryClient } from "../queryClient";
import * as api from "../api";

const roots = (keys) => keys.map(([root]) => root);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("queryKeysForWrite", () => {
  it("returns nothing for reads", () => {
    expect(queryKeysForWrite("GET", "/students/1")).toEqual([]);
    expect(queryKeysForWrite(undefined, "/lessons")).toEqual([]);
  });

  it("refreshes profile, debtors, movements and finance after a lesson payment", () => {
    const keys = roots(queryKeysForWrite("POST", "/payments/cash"));
    for (const root of ["student", "debtors", "movements", "weekLessons", "weeklyKpi", "financeFlow", "studentsKpi"]) {
      expect(keys).toContain(root);
    }
  });

  it("refreshes the same groups after completing or uncompleting a lesson", () => {
    expect(roots(queryKeysForWrite("POST", "/lessons/12/complete"))).toContain("student");
    expect(roots(queryKeysForWrite("POST", "/lessons/12/uncomplete"))).toContain("debtors");
    expect(roots(queryKeysForWrite("PATCH", "/lessons/12/status"))).toContain("occupancyFlow");
    expect(roots(queryKeysForWrite("DELETE", "/lessons/12"))).toContain("weekLessons");
  });

  it("also refreshes products after a product sale (stock changes)", () => {
    const keys = roots(queryKeysForWrite("POST", "/product-sales"));
    expect(keys).toContain("products");
    expect(keys).toContain("student");
  });

  it("does not refetch the deleted student's own queries", () => {
    const keys = roots(queryKeysForWrite("DELETE", "/students/7"));
    expect(keys).not.toContain("student");
    expect(keys).toContain("students");
    expect(keys).toContain("debtors");
    expect(roots(queryKeysForWrite("PATCH", "/students/7"))).toContain("student");
  });

  it("ignores endpoints that manage their own refresh or change nothing on screen", () => {
    expect(queryKeysForWrite("POST", "/activity/ping")).toEqual([]);
    expect(queryKeysForWrite("POST", "/auth/login")).toEqual([]);
    expect(queryKeysForWrite("POST", "/notes/views")).toEqual([]);
    expect(queryKeysForWrite("POST", "/notes")).toEqual([]);
    expect(queryKeysForWrite("POST", "/trendyol/orders/label")).toEqual([]);
    expect(queryKeysForWrite("POST", "/push/subscribe")).toEqual([]);
    expect(queryKeysForWrite("PATCH", "/users/3")).toEqual([]);
  });

  it("refreshes finance and student balances after event payments, not event screens", () => {
    const keys = roots(queryKeysForWrite("POST", "/events/participants/4/payments"));
    expect(keys).toEqual(expect.arrayContaining(["student", "weeklyKpi", "financeFlow", "movements"]));
    expect(keys).not.toContain("event");
  });

  it("accepts lowercase methods and strips query strings", () => {
    expect(roots(queryKeysForWrite("post", "/payments/cash?x=1"))).toContain("student");
  });
});

describe("invalidateAfterWrite", () => {
  let client;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  });

  afterEach(() => {
    client.clear();
  });

  it("marks affected queries stale and leaves unrelated ones alone", async () => {
    client.setQueryData(["student", "42"], { id: "42" });
    client.setQueryData(["student", "42", "lessons"], []);
    client.setQueryData(["debtors"], []);
    client.setQueryData(["notes"], []);

    invalidateAfterWrite("POST", "/payments/cash", client);
    await tick();

    expect(client.getQueryState(["student", "42"]).isInvalidated).toBe(true);
    expect(client.getQueryState(["student", "42", "lessons"]).isInvalidated).toBe(true);
    expect(client.getQueryState(["debtors"]).isInvalidated).toBe(true);
    expect(client.getQueryState(["notes"]).isInvalidated).toBe(false);
  });

  it("refetches an open screen right away", async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const observer = new QueryObserver(client, { queryKey: ["student", "42", "lessons"], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    invalidateAfterWrite("POST", "/lessons/9/complete", client);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    unsubscribe();
  });

  it("does not fetch twice when the screen already refreshed the same data", async () => {
    let resolveSecond;
    const queryFn = vi.fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }))
      .mockResolvedValue([]);
    const observer = new QueryObserver(client, { queryKey: ["weekLessons", 0], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => {
      expect(client.getQueryState(["weekLessons", 0])).toMatchObject({ status: "success", fetchStatus: "idle" });
    });

    // Ekranın kendi tazelemesi (await'ten hemen sonra) önce çalışır…
    invalidateAfterWrite("POST", "/lessons/9/complete", client);
    client.invalidateQueries({ queryKey: ["weekLessons"] });
    expect(queryFn).toHaveBeenCalledTimes(2);

    // …merkezi tazeleme süren isteği iptal edip yeniden atmaz.
    await tick();
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(2);
    resolveSecond([]);
    unsubscribe();
  });
});

describe("apiRequest wiring", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    appQueryClient.setQueryData(["student", "5", "lessons"], []);
  });

  afterEach(() => {
    appQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it("refreshes the student profile after a successful payment", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ data: { id: "p1" } }, 201));

    await api.createCashPayment({ targetType: "lesson", targetId: "9", amount: 100, source: "cash" });
    await tick();

    expect(appQueryClient.getQueryState(["student", "5", "lessons"]).isInvalidated).toBe(true);
  });

  it("refreshes nothing when the write is rejected", async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "OVERPAYMENT_NOT_ALLOWED", message: "x" } }, 409),
    );

    await expect(
      api.createCashPayment({ targetType: "lesson", targetId: "9", amount: 999, source: "cash" }),
    ).rejects.toThrow();
    await tick();

    expect(appQueryClient.getQueryState(["student", "5", "lessons"]).isInvalidated).toBe(false);
  });
});
