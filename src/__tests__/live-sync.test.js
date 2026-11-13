/**
 * Canlı senkron istemcisi (hooks/useLiveSync.js → createLiveSync).
 *
 * Sahte EventSource / belge / pencere ile: başkasının değişikliği ilgili
 * ekranları tazeler, kendi yazmamızın sinyali yutulur, arka planda bağlantı
 * kapanır ve dönüşte kaldığı yerden devam eder, devam edemezse her şey bir
 * kez tazelenir, ölü bağlantı ve kalıcı ret yeniden kurulur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { createLiveSync } from "../hooks/useLiveSync";
import {
  SYNCED_QUERY_KEYS,
  consumeOwnWrite,
  queryKeysForWrite,
  rememberOwnWrite,
} from "../hooks/writeInvalidation";

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    this.listeners = {};
    this.onerror = null;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  emit(type, data, id = "") {
    this.readyState = 1;
    const event = { data: JSON.stringify(data), lastEventId: id };
    for (const fn of this.listeners[type] || []) fn(event);
  }

  failPermanently() {
    this.readyState = 2;
    this.onerror?.({});
  }

  close() {
    this.readyState = 2;
    this.closed = true;
  }
}

function fakeDocument() {
  const target = new EventTarget();
  target.visibilityState = "visible";
  target.setVisibility = (state) => {
    target.visibilityState = state;
    target.dispatchEvent(new Event("visibilitychange"));
  };
  return target;
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];
const invalidatedKeys = (spy) => spy.mock.calls.map(([filters]) => JSON.stringify(filters.queryKey));

describe("createLiveSync", () => {
  let queryClient;
  let invalidate;
  let doc;
  let win;
  let sync;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    doc = fakeDocument();
    win = new EventTarget();
    sync = createLiveSync({
      queryClient,
      createEventSource: (url) => new FakeEventSource(url),
      streamUrl: (since) => `/live${since ? `?since=${since}` : ""}`,
      doc,
      win,
    });
    sync.start();
  });

  afterEach(() => {
    sync.stop();
    // Modül içi "kendi yazmalarım" listesinde artık kalmasın.
    while (consumeOwnWrite("POST", "/payments/cash")) { /* boşalt */ }
    vi.useRealTimers();
  });

  it("opens one stream on start", () => {
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().url).toBe("/live");
  });

  it("refreshes the screens another user's write touched, batched and deduplicated", () => {
    const es = latest();
    es.emit("hello", { instance: "a", seq: 0, resumed: false }, "a:0");
    es.emit("change", { seq: 1, method: "POST", path: "/payments/cash" }, "a:1");
    es.emit("change", { seq: 2, method: "POST", path: "/lessons/9/complete" }, "a:2");
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(["student"]));
    expect(keys).toContain(JSON.stringify(["debtors"]));
    expect(keys).toContain(JSON.stringify(["movements"]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores the signal of this device's own write once", () => {
    const es = latest();
    es.emit("hello", { instance: "a", seq: 0, resumed: false }, "a:0");
    rememberOwnWrite("POST", "/payments/cash");

    es.emit("change", { seq: 1, method: "POST", path: "/payments/cash" }, "a:1");
    vi.advanceTimersByTime(300);
    expect(invalidate).not.toHaveBeenCalled();

    // Aynı uç bu kez başka birinden: tazelenir.
    es.emit("change", { seq: 2, method: "POST", path: "/payments/cash" }, "a:2");
    vi.advanceTimersByTime(300);
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(["student"]));
  });

  it("ignores signals for endpoints outside the map", () => {
    const es = latest();
    es.emit("change", { seq: 1, method: "POST", path: "/notes" }, "a:1");
    vi.advanceTimersByTime(300);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not refresh on the very first connection", () => {
    latest().emit("hello", { instance: "a", seq: 5, resumed: false }, "a:5");
    vi.advanceTimersByTime(300);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("closes the stream in the background and resumes from the last signal", () => {
    const first = latest();
    first.emit("hello", { instance: "a", seq: 5, resumed: false }, "a:5");
    first.emit("change", { seq: 6, method: "PATCH", path: "/students/3" }, "a:6");
    vi.advanceTimersByTime(300);
    invalidate.mockClear();

    doc.setVisibility("hidden");
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    doc.setVisibility("visible");
    const second = latest();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(second.url).toBe("/live?since=a:6");

    // Sunucu kaçırılanı tekrar oynattı: yalnız o tazelenir.
    second.emit("hello", { instance: "a", seq: 7, resumed: true }, "a:7");
    second.emit("change", { seq: 7, method: "POST", path: "/payments/cash" }, "a:7");
    vi.advanceTimersByTime(300);
    expect(invalidatedKeys(invalidate)).not.toContain(JSON.stringify(["calendarEvents"]));
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(["debtors"]));
  });

  it("refreshes everything when the server cannot replay what was missed", () => {
    latest().emit("hello", { instance: "a", seq: 5, resumed: false }, "a:5");
    doc.setVisibility("hidden");
    doc.setVisibility("visible");

    latest().emit("hello", { instance: "b", seq: 0, resumed: false }, "b:0");
    vi.advanceTimersByTime(300);
    const keys = invalidatedKeys(invalidate);
    for (const key of SYNCED_QUERY_KEYS) expect(keys).toContain(JSON.stringify(key));
  });

  it("does not connect while hidden", () => {
    doc.setVisibility("hidden");
    win.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(120_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().closed).toBe(true);
  });

  it("reconnects a stream that went silent for a minute", () => {
    const first = latest();
    first.emit("hello", { instance: "a", seq: 2, resumed: false }, "a:2");
    vi.advanceTimersByTime(45_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    first.emit("ping", {});
    vi.advanceTimersByTime(45_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(30_000);
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(latest().url).toBe("/live?since=a:2");
  });

  it("retries a rejected stream with growing delays", () => {
    latest().failPermanently();
    vi.advanceTimersByTime(2_999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    latest().failPermanently();
    vi.advanceTimersByTime(5_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("stops cleanly", () => {
    const es = latest();
    sync.stop();
    expect(es.closed).toBe(true);
    doc.setVisibility("hidden");
    doc.setVisibility("visible");
    vi.advanceTimersByTime(120_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe("write map additions for live sync", () => {
  it("refreshes lessons and money after package writes", () => {
    const keys = queryKeysForWrite("POST", "/packages").map(([root]) => root);
    expect(keys).toContain("student");
    expect(keys).toContain("debtors");
  });

  it("matches own writes by method and path, ignoring query strings", () => {
    rememberOwnWrite("PATCH", "/students/4?x=1");
    expect(consumeOwnWrite("POST", "/students/4")).toBe(false);
    expect(consumeOwnWrite("PATCH", "/students/4")).toBe(true);
    expect(consumeOwnWrite("PATCH", "/students/4")).toBe(false);
  });

  it("forgets own writes after 15 seconds", () => {
    rememberOwnWrite("DELETE", "/payments/3", 1_000);
    expect(consumeOwnWrite("DELETE", "/payments/3", 17_000)).toBe(false);
  });

  it("does not remember reads", () => {
    rememberOwnWrite("GET", "/students");
    expect(consumeOwnWrite("GET", "/students")).toBe(false);
  });
});
