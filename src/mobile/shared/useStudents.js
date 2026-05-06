import { useQuery } from '@tanstack/react-query';
import { getStudents, getStudentsKpi } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';

export function useStudents() {
  const studentsQuery = useQuery({
    queryKey: queryKeys.students(),
    queryFn: getStudents,
    staleTime: 2 * 60 * 1000,
  });
  const kpiQuery = useQuery({
    queryKey: queryKeys.studentsKpi(),
    queryFn: getStudentsKpi,
    staleTime: 2 * 60 * 1000,
  });
  return {
    students: studentsQuery.data ?? null,
    kpi: kpiQuery.data ?? null,
    isLoading: studentsQuery.isLoading || kpiQuery.isLoading,
    error: (studentsQuery.error?.message || kpiQuery.error?.message) ?? null,
  };
}
