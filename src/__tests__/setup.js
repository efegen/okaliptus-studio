/**
 * Vitest setup — registers @testing-library/jest-dom matchers and a global
 * fetch stub. Each test file overrides fetch via vi.spyOn(global, "fetch")
 * or vi.stubGlobal as needed.
 *
 * jsdom localStorage is provided by default; no setup needed.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement matchMedia. Mobile hooks/components rely on it,
// so polyfill before any module under test reads window.matchMedia.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// Default: any unstubbed fetch returns a 500 so tests that forget to mock fail loudly.
globalThis.fetch = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: { code: "UNSTUBBED", message: "fetch not stubbed" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }),
  ),
);
