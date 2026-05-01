import { useEffect, useState } from 'react';

/*
 * "Mobile" = touch-first device OR a narrow viewport.
 *
 * Why two signals OR'd together?
 *   - max-width alone misses iPhone landscape (e.g. iPhone 14 = 852px wide
 *     in landscape, well above any sane phone breakpoint). Those users still
 *     need the mobile shell.
 *   - pointer: coarse alone misses desktop browsers in narrow windows (e.g.
 *     a side-by-side window on a laptop). Those users want mobile shell too.
 * Listen on both queries so the shell flips when either signal changes
 * (e.g. user rotates the phone, resizes the window, plugs in a mouse).
 */

const NARROW_QUERY = '(max-width: 900px)';
const COARSE_QUERY = '(pointer: coarse)';

function evaluate() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return (
    window.matchMedia(NARROW_QUERY).matches ||
    window.matchMedia(COARSE_QUERY).matches
  );
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(evaluate);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const narrow = window.matchMedia(NARROW_QUERY);
    const coarse = window.matchMedia(COARSE_QUERY);
    const update = () => setIsMobile(narrow.matches || coarse.matches);

    function subscribe(mq) {
      if (mq.addEventListener) {
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
      }
      mq.addListener(update);
      return () => mq.removeListener(update);
    }

    const unsubNarrow = subscribe(narrow);
    const unsubCoarse = subscribe(coarse);
    update();
    return () => {
      unsubNarrow();
      unsubCoarse();
    };
  }, []);

  return isMobile;
}
