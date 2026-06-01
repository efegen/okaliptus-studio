import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../layout';
import { useStudents } from './shared/useStudents';
import { queryKeys } from '../hooks/queryKeys';
import { MobileStudentTriage } from './MobileStudentTriage';
import { MobileCreateStudentPage } from './MobileCreateStudentPage';
import { MobileToast } from './MobileToast';

export function MobileStudents({ onOpenStudent }) {
  const [query, setQuery] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const [toastMessage, setToastMessage] = React.useState(null);
  const { students, isLoading, error } = useStudents();

  function handleCreateClick() {
    setCreateOpen(true);
  }

  function handlePageClose() {
    setCreateOpen(false);
  }

  function handleCreated() {
    setCreateOpen(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.students() });
    queryClient.invalidateQueries({ queryKey: queryKeys.studentsKpi() });
    setToastMessage('Öğrenci eklendi');
  }

  return (
    <>
      <div className="mobile-students-page">
        <div className="mobile-students-topbar">
          <div className="mobile-students-topbar-title">
            <h1>Öğrenciler</h1>
            {students && (
              <span className="mobile-students-topbar-count">{students.length}</span>
            )}
          </div>
          <button
            type="button"
            className="mobile-iconbtn"
            aria-label="Yeni öğrenci"
            onClick={handleCreateClick}
          >
            <Icon.Plus width="22" height="22" />
          </button>
        </div>

        <div className="mobile-students-searchwrap">
          <div className="mobile-students-search">
            <Icon.Search width="17" height="17" />
            <input
              type="search"
              placeholder="İsim veya telefon ara…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        <MobileStudentTriage
          students={students}
          query={query}
          isLoading={isLoading}
          error={error}
          onOpenStudent={onOpenStudent}
        />

        <MobileToast
          message={toastMessage}
          onDismiss={() => setToastMessage(null)}
        />
      </div>

      {createOpen && (
        <MobileCreateStudentPage
          onClose={handlePageClose}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
