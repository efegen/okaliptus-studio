import { useQuery } from '@tanstack/react-query';
import { getWeeklyKpi } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';

export function parseNumericValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampBarWidth(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function useWeeklyKpi() {
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.weeklyKpi(),
    queryFn: getWeeklyKpi,
    staleTime: 2 * 60 * 1000,
  });
  return {
    data: data ?? null,
    error: error?.message ?? null,
    isLoading,
  };
}
