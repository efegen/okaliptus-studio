import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../layout';
import { useStudents } from './shared/useStudents';
import { queryKeys } from '../hooks/queryKeys';
import { MobileStudentsKpi } from './MobileStudentsKpi';
import { MobileStudentList } from './MobileStudentList';
import { MobileCreateStudentPage } from './MobileCreateStudentPage';
import { MobileToast } from './MobileToast';
import { MobileStudentsMenu } from './MobileStudentsMenu';

export function MobileStudents({ onOpenStudent }) {
  const [query, setQuery] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const [toastMessage, setToastMessage] = React.useState(null);
  const [activeFilter, setActiveFilter] = React.useState(null);
  const [filterMode, setFilterMode] = React.useState('all');
  const [sortMode, setSortMode] = React.useState('name-asc');
  const [openMenu, setOpenMenu] = React.useState(null);
  const filterTriggerRef = React.useRef(null);
  const sortTriggerRef = React.useRef(null);
  const { students, kpi, isLoading, error } = useStudents();

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

  function handleToggleFilter(id) {
    setActiveFilter(prev => (prev === id ? null : id));
  }

  function handleResetFilter() {
    setFilterMode('all');
  }

  const filterActive = filterMode !== 'all';
  const sortActive = sortMode !== 'name-asc';

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

        <MobileStudentsKpi
          kpi={kpi}
          isLoading={isLoading}
          activeFilter={activeFilter}
          onToggleFilter={handleToggleFilter}
        />

        <div className="mobile-students-filterbar">
          <div className="mobile-students-filter-input">
            <Icon.Search width="16" height="16" />
            <input
              type="search"
              placeholder="İsim veya telefon ara…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <button
            ref={filterTriggerRef}
            type="button"
            className={'mobile-students-iconbtn' + (filterActive ? ' has-active' : '')}
            aria-label="Filtrele"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'filter'}
            onClick={() => setOpenMenu(o => (o === 'filter' ? null : 'filter'))}
          >
            <Icon.Filter width="18" height="18" />
          </button>
          <button
            ref={sortTriggerRef}
            type="button"
            className={'mobile-students-iconbtn' + (sortActive ? ' has-active' : '')}
            aria-label="Sırala"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'sort'}
            onClick={() => setOpenMenu(o => (o === 'sort' ? null : 'sort'))}
          >
            <Icon.Sort width="18" height="18" />
          </button>
        </div>

        <MobileStudentList
          students={students}
          query={query}
          isLoading={isLoading}
          error={error}
          activeFilter={activeFilter}
          filterMode={filterMode}
          sortMode={sortMode}
          onOpenStudent={onOpenStudent}
          onResetFilter={filterActive ? handleResetFilter : null}
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

      <MobileStudentsMenu
        open={openMenu === 'filter'}
        onClose={() => setOpenMenu(null)}
        triggerRef={filterTriggerRef}
        kind="filter"
        value={filterMode}
        onChange={setFilterMode}
        students={students}
      />

      <MobileStudentsMenu
        open={openMenu === 'sort'}
        onClose={() => setOpenMenu(null)}
        triggerRef={sortTriggerRef}
        kind="sort"
        value={sortMode}
        onChange={setSortMode}
        students={students}
      />
    </>
  );
}
