import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getStudentById,
  getStudentLessons,
  getStudentProductSales,
  updateStudent,
  deleteStudent,
} from '../api';
import { queryKeys } from './queryKeys';

export function useStudent(studentId, { enabled = true } = {}) {
  return useQuery({
    queryKey: studentId != null ? queryKeys.studentById(studentId) : ['student', null],
    queryFn: () => getStudentById(studentId),
    enabled: enabled && studentId != null,
    staleTime: 30 * 1000,
  });
}

export function useStudentLessons(studentId, { enabled = true } = {}) {
  return useQuery({
    queryKey: studentId != null ? queryKeys.studentLessons(studentId) : ['student', null, 'lessons'],
    queryFn: () => getStudentLessons(studentId),
    enabled: enabled && studentId != null,
    staleTime: 30 * 1000,
  });
}

export function useStudentSales(studentId, { enabled = true } = {}) {
  return useQuery({
    queryKey: studentId != null ? queryKeys.studentProductSales(studentId) : ['student', null, 'productSales'],
    queryFn: () => getStudentProductSales(studentId),
    enabled: enabled && studentId != null,
    staleTime: 30 * 1000,
  });
}

export function useUpdateStudent(studentId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => updateStudent(studentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.studentById(studentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.students() });
      queryClient.invalidateQueries({ queryKey: queryKeys.studentsKpi() });
      queryClient.invalidateQueries({ queryKey: queryKeys.debtors() });
    },
  });
}

export function useDeleteStudent(studentId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteStudent(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.students() });
      queryClient.invalidateQueries({ queryKey: queryKeys.studentsKpi() });
      queryClient.invalidateQueries({ queryKey: queryKeys.debtors() });
      queryClient.removeQueries({ queryKey: queryKeys.studentById(studentId) });
    },
  });
}
