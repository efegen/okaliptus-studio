// Eğitmenler page — lists created instructors (read-only v1)

import React from 'react';
import { getInstructors } from './api';

export function InstructorsPage() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getInstructors()
      .then(data => { if (!cancelled) setItems(data); })
      .catch(err => { if (!cancelled) setError(err.message || 'Eğitmenler yüklenemedi.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page settings-page">
      <div className="page-head page-head-solo">
        <div>
          <div className="eyebrow">{items.length} eğitmen</div>
          <h1 className="page-title">Eğitmenler</h1>
        </div>
      </div>

      {loading ? (
        <div className="stg-loading">Yükleniyor…</div>
      ) : error ? (
        <div className="stg-feedback stg-feedback-err">{error}</div>
      ) : (
        <div className="stg-section">
          <div className="stg-section-head">Aktif eğitmenler</div>
          {items.length === 0 ? (
            <div className="stu-state-msg">Henüz eğitmen tanımlı değil.</div>
          ) : (
            items.map(ins => (
              <div className="stg-row" key={ins.id}>
                <div className="stg-row-label">{ins.full_name}</div>
                <div className="stg-row-control">
                  <span className={'pill pill-' + (ins.is_active ? 'sage' : 'neutral')}>
                    {ins.is_active ? 'Aktif' : 'Pasif'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
