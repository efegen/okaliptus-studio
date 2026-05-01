import React from 'react';
import { getInstructors, createInstructor, updateInstructor, deleteInstructor } from './api';
import { Icon } from './layout';

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Aktif' },
  { key: 'passive', label: 'Pasif' },
];

const TONE_KEYS = ['lesson', 'payment', 'sale', 'package', 'student'];

function getInstructorTone(id) {
  const n = typeof id === 'number' ? id : parseInt(id, 10);
  if (!Number.isFinite(n)) return TONE_KEYS[0];
  return TONE_KEYS[Math.abs(n) % TONE_KEYS.length];
}

function getInstructorMark(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR') || 'EĞ';
}

function InstructorModal({ initial, onSave, onClose }) {
  const isNew = !initial;
  const [form, setForm] = React.useState(
    initial
      ? { full_name: initial.full_name, is_active: initial.is_active }
      : { full_name: '', is_active: true }
  );
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState(null);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setErr(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    const fullName = form.full_name.trim();

    if (!fullName) return setErr('İsim zorunlu.');

    setSaving(true);
    setErr(null);
    try {
      const payload = isNew
        ? await createInstructor({ full_name: fullName })
        : await updateInstructor(initial.id, { full_name: fullName, is_active: form.is_active });
      onSave(payload);
    } catch (e) {
      setErr(e.message || 'Kaydedilemedi.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal lt-modal">
        <div className="lt-modal-head">
          <div className="lt-modal-mark" aria-hidden="true">
            <Icon.Instructor width="18" height="18" />
          </div>
          <h3>{isNew ? 'Yeni eğitmen' : 'Eğitmeni düzenle'}</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Ad Soyad</label>
            <input
              autoFocus
              value={form.full_name}
              onChange={e => set('full_name', e.target.value)}
              placeholder="ör. Efe Genç"
            />
          </div>

          {!isNew && (
            <div className="form-row" style={{ marginTop: 8 }}>
              <label>Durum</label>
              <div className="lt-status-toggle" aria-label="Eğitmen durumu">
                <button
                  type="button"
                  className={'lt-status-btn' + (form.is_active ? ' is-active' : '')}
                  onClick={() => set('is_active', true)}
                >Aktif</button>
                <button
                  type="button"
                  className={'lt-status-btn' + (!form.is_active ? ' is-passive' : '')}
                  onClick={() => set('is_active', false)}
                >Pasif</button>
              </div>
            </div>
          )}

          {err && <div className="stg-feedback stg-feedback-err" style={{ marginTop: 12 }}>{err}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              İptal
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InstructorCard({ instructor, onEdit, onDelete }) {
  const tone = getInstructorTone(instructor.id);
  const isActive = !!instructor.is_active;
  const className = [
    'lt-card',
    `lt-tone-${tone}`,
    isActive ? '' : 'is-passive',
  ].filter(Boolean).join(' ');

  return (
    <article className={className}>
      <header className="lt-card-top">
        <span className="lt-card-mark" aria-hidden="true">{getInstructorMark(instructor.full_name)}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="iconbtn lt-card-edit"
            onClick={() => onEdit(instructor)}
            aria-label={`${instructor.full_name} düzenle`}
            title="Düzenle"
          >
            <Icon.Edit width="14" height="14" />
          </button>
          <button
            type="button"
            className="iconbtn lt-card-edit"
            onClick={() => onDelete(instructor)}
            aria-label={`${instructor.full_name} sil`}
            title="Sil"
          >
            <Icon.LogOut width="14" height="14" />
          </button>
        </div>
      </header>

      <div className="lt-card-body">
        <h2 className="lt-card-name">{instructor.full_name}</h2>
        <span className={'lt-card-status ' + (isActive ? 'is-active' : 'is-passive')}>
          <span className="lt-card-status-dot" aria-hidden="true" />
          {isActive ? 'Aktif' : 'Pasif'}
        </span>
      </div>
    </article>
  );
}

export function InstructorsSection() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [modal, setModal] = React.useState(null); // null | 'new' | instructorObj
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getInstructors({ includeAll: true })
      .then(data => { if (!cancelled) { setItems(data); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Eğitmenler yüklenemedi.'); setLoading(false); } });

    return () => { cancelled = true; };
  }, []);

  function handleSaved(updated) {
    setItems(prev => {
      const idx = prev.findIndex(x => x.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated];
    });
    setModal(null);
  }

  async function handleDelete(instructor) {
    const ok = window.confirm(`"${instructor.full_name}" eğitmeni silinsin mi?`);
    if (!ok) return;
    try {
      await deleteInstructor(instructor.id);
      setItems(prev => prev.filter(x => x.id !== instructor.id));
    } catch (e) {
      window.alert(e.message || 'Eğitmen silinemedi.');
    }
  }

  const activeCount = items.filter(x => x.is_active).length;
  const passiveCount = items.length - activeCount;
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');
  const visibleItems = React.useMemo(() => {
    return items
      .filter(item => {
        if (statusFilter === 'active' && !item.is_active) return false;
        if (statusFilter === 'passive' && item.is_active) return false;
        if (!normalizedQuery) return true;
        return item.full_name.toLocaleLowerCase('tr-TR').includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.full_name.localeCompare(b.full_name, 'tr-TR');
      });
  }, [items, normalizedQuery, statusFilter]);

  const filterCounts = {
    all: items.length,
    active: activeCount,
    passive: passiveCount,
  };

  return (
    <section className="catalog-section">
      <div className="catalog-section-head">
        <div className="eyebrow">{activeCount} aktif · {items.length} toplam</div>
        <div className="head-actions">
          <label className="lt-search">
            <Icon.Search width="15" height="15" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Eğitmen ara"
              placeholder="Ara..."
              disabled={items.length === 0}
            />
          </label>
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Icon.Plus width="14" height="14"/>
            Yeni eğitmen
          </button>
        </div>
      </div>

      {loading ? (
        <div className="lt-state">Yükleniyor…</div>
      ) : error ? (
        <div className="stg-feedback stg-feedback-err">{error}</div>
      ) : items.length === 0 ? (
        <div className="lt-empty">
          <div className="lt-empty-icon">
            <Icon.Instructor width="28" height="28"/>
          </div>
          <div className="lt-empty-title">Henüz eğitmen tanımlı değil</div>
          <div className="lt-empty-sub">İlk eğitmeni ekleyerek ders ekleyebilir hale gel.</div>
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Icon.Plus width="14" height="14"/>
            İlk eğitmeni ekle
          </button>
        </div>
      ) : (
        <>
          <div className="lt-filters" role="tablist" aria-label="Durum filtresi">
            {FILTERS.map(filter => (
              <button
                key={filter.key}
                type="button"
                role="tab"
                className={'lt-chip' + (statusFilter === filter.key ? ' is-active' : '')}
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={statusFilter === filter.key}
              >
                {filter.label}
                <span className="lt-chip-count">{filterCounts[filter.key]}</span>
              </button>
            ))}
          </div>

          {visibleItems.length === 0 ? (
            <div className="lt-state lt-state-empty">
              <Icon.Search width="20" height="20" />
              <span>Eşleşen eğitmen bulunamadı.</span>
            </div>
          ) : (
            <div className="lt-grid">
              {visibleItems.map(ins => (
                <InstructorCard
                  key={ins.id}
                  instructor={ins}
                  onEdit={setModal}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      {modal && (
        <InstructorModal
          initial={modal === 'new' ? null : modal}
          onSave={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  );
}
