/**
 * useIsMobile — covers the 4 quadrants of the (pointer × viewport) matrix.
 *
 * The hook returns true when EITHER pointer is coarse (touch device) OR
 * viewport <= 900px. So:
 *   touch  + narrow → mobile (obvious phone case)
 *   touch  + wide   → mobile (iPhone landscape: 852px, the bug we're fixing)
 *   mouse  + narrow → mobile (laptop side-by-side window)
 *   mouse  + wide   → desktop
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIsMobile } from "../mobile/useIsMobile";

function mockMatchMedia({ coarse, narrow }) {
  // Stable list returned per query so add/removeEventListener calls land on
  // the same MediaQueryList instance the hook subscribed to.
  const make = (matches, media) => {
    const listeners = new Set();
    return {
      matches,
      media,
      onchange: null,
      addEventListener: (_evt, cb) => listeners.add(cb),
      removeEventListener: (_evt, cb) => listeners.delete(cb),
      addListener: (cb) => listeners.add(cb),
      removeListener: (cb) => listeners.delete(cb),
      dispatchEvent: () => false,
      __listeners: listeners,
    };
  };
  const coarseMql = make(coarse, "(pointer: coarse)");
  const narrowMql = make(narrow, "(max-width: 900px)");
  window.matchMedia = (q) => {
    if (q.includes("pointer: coarse")) return coarseMql;
    if (q.includes("max-width: 900px")) return narrowMql;
    return make(false, q);
  };
  return { coarseMql, narrowMql };
}

describe("useIsMobile", () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("touch device + narrow viewport → mobile (typical phone portrait)", () => {
    mockMatchMedia({ coarse: true, narrow: true });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("touch device + wide viewport → mobile (iPhone landscape, 852px)", () => {
    // The bug we're fixing: 852px is over 768px but it's still a phone.
    mockMatchMedia({ coarse: true, narrow: false });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("mouse device + narrow viewport → mobile (laptop side-by-side window)", () => {
    mockMatchMedia({ coarse: false, narrow: true });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("mouse device + wide viewport → desktop", () => {
    mockMatchMedia({ coarse: false, narrow: false });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
