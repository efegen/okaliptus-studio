import React from 'react';
import { Icon } from './layout';
import { LessonTypesSection } from './lesson-types';
import { InstructorsSection } from './instructors';

const TABS = [
  { id: 'lesson-types', label: 'Ders Türleri', icon: Icon.Layers },
  { id: 'instructors',  label: 'Eğitmenler',  icon: Icon.Instructor },
];

export function CatalogPage() {
  const [tab, setTab] = React.useState('lesson-types');

  return (
    <div className="page catalog-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dersler ve Eğitmenler</h1>
        </div>
      </div>

      <div className="catalog-tabs" role="tablist" aria-label="Katalog sekmeleri">
        {TABS.map(t => {
          const I = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={'catalog-tab' + (active ? ' is-active' : '')}
              onClick={() => setTab(t.id)}
            >
              <I width="15" height="15" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'lesson-types' ? <LessonTypesSection /> : <InstructorsSection />}
    </div>
  );
}
