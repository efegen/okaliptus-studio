import React from 'react';
import { getStudents, getStudentsKpi } from '../../api';

export function useStudents(refreshKey = 0) {
  const [state, setState] = React.useState({
    students: null,
    kpi: null,
    error: null,
    isLoading: true,
  });

  React.useEffect(() => {
    let cancelled = false;
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    async function load() {
      try {
        const [students, kpi] = await Promise.all([
          getStudents(),
          getStudentsKpi(),
        ]);
        if (cancelled) return;
        setState({ students, kpi, error: null, isLoading: false });
      } catch (error) {
        if (cancelled) return;
        console.error('[useStudents] yüklenemedi:', error);
        setState({
          students: null,
          kpi: null,
          error: error instanceof Error ? error.message : 'Öğrenci verisi alınamadı.',
          isLoading: false,
        });
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return state;
}
