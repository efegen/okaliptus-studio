import React from 'react';
import { getWeeklyKpi } from '../../api';

function parseNumericValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampBarWidth(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function useWeeklyKpi() {
  const [state, setState] = React.useState({
    data: null,
    error: null,
    isLoading: true,
  });

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getWeeklyKpi();
        if (cancelled) return;
        setState({ data, error: null, isLoading: false });
      } catch (error) {
        if (cancelled) return;
        console.error('[useWeeklyKpi] fetch basarisiz:', error);
        setState({
          data: null,
          error: error instanceof Error ? error.message : 'Haftalik KPI verisi alinamadi.',
          isLoading: false,
        });
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return state;
}

export { parseNumericValue, clampBarWidth };
