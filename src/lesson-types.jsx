import React from 'react';
import { getLessonTypes, createLessonType, updateLessonType } from './api';
import { Icon } from './layout';

function formatPriceTRY(raw) {
  if (raw === null || raw === undefined || raw === '') return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  const hasFraction = Math.abs(n - Math.trunc(n)) > 0.0001;
  return `₺${n.toLocaleString('tr-TR', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

const EMPTY_FORM = { name: '', default_duration_minutes: '60', default_price: '' };
const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Aktif' },
  { key: 'passive', label: 'Pasif' },
];

const TONE_KEYS = ['lesson', 'payment', 'sale', 'package', 'student'];

function getLessonTypeTone(id) {
  const n = typeof id === 'number' ? id : parseInt(id, 10);
  if (!Number.isFinite(n)) return TONE_KEYS[0];
  return TONE_KEYS[Math.abs(n) % TONE_KEYS.length];
}

function getLessonTypeMark(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR') || 'DT';
}

function LessonTypeModal({ initial, onSave, onClose }) {
  const isNew = !initial;
  const [form, setForm] = React.useState(
    initial
      ? { name: initial.name, default_duration_minutes: String(initial.default_duration_minutes), default_price: String(initial.default_price), is_active: initial.is_active }
      : { ...EMPTY_FORM, is_active: true }
  );
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState(null);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setErr(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    const name = form.name.trim();
    const dur = parseInt(form.default_duration_minutes, 10);
    const price = parseFloat(form.default_price);

    if (!name) return setErr('İsim zorunlu.');
    if (!Number.isFinite(dur) || dur <= 0 || dur > 240) return setErr('Süre 1–240 dakika arasında olmalı.');
    if (!Number.isFinite(price) || price < 0) return setErr('Geçerli bir fiyat gir.');

    setSaving(true);
    setErr(null);
    try {
      const payload = isNew
        ? await createLessonType({ name, default_duration_minutes: dur, default_price: price })
        : await updateLessonType(initial.id, { name, default_duration_minutes: dur, default_price: price, is_active: form.is_active });
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
            <Icon.Layers width="18" height="18" />
          </div>
          <h3>{isNew ? 'Yeni ders türü' : 'Ders türünü düzenle'}</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>İsim</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="ör. Yoga & Meditasyon"
            />
          </div>

          <div className="form-row-2">
            <div className="form-row" style={{ margin: 0 }}>
              <label>Süre (dk)</label>
              <input
                type="number"
                min={1}
                max={240}
                value={form.default_duration_minutes}
                onChange={e => set('default_duration_minutes', e.target.value)}
              />
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Liste fiyatı (₺)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.default_price}
                onChange={e => set('default_price', e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {!isNew && (
            <div className="form-row" style={{ marginTop: 8 }}>
              <label>Durum</label>
              <div className="lt-status-toggle" aria-label="Ders türü durumu">
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

function LessonTypeCard({ lt, onEdit }) {
  const tone = getLessonTypeTone(lt.id);
  const isActive = !!lt.is_active;
  const className = [
    'lt-card',
    `lt-tone-${tone}`,
    isActive ? '' : 'is-passive',
  ].filter(Boolean).join(' ');

  return (
    <article className={className}>
      <header className="lt-card-top">
        <span className="lt-card-mark" aria-hidden="true">{getLessonTypeMark(lt.name)}</span>
        <button
          type="button"
          className="iconbtn lt-card-edit"
          onClick={() => onEdit(lt)}
          aria-label={`${lt.name} düzenle`}
          title="Düzenle"
        >
          <Icon.Edit width="14" height="14" />
        </button>
      </header>

      <div className="lt-card-body">
        <h2 className="lt-card-name">{lt.name}</h2>
        <span className={'lt-card-status ' + (isActive ? 'is-active' : 'is-passive')}>
          <span className="lt-card-status-dot" aria-hidden="true" />
          {isActive ? 'Aktif' : 'Pasif'}
        </span>
      </div>

      <dl className="lt-card-stats">
        <div className="lt-card-stat">
          <dt className="lt-card-stat-label">Süre</dt>
          <dd className="lt-card-stat-value">
            <Icon.Clock width="14" height="14" />
            {lt.default_duration_minutes} dk
          </dd>
        </div>
        <div className="lt-card-stat">
          <dt className="lt-card-stat-label">Liste fiyatı</dt>
          <dd className="lt-card-stat-value is-price">{formatPriceTRY(lt.default_price)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function LessonTypesSection() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [modal, setModal] = React.useState(null); // null | 'new' | lessonTypeObj
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getLessonTypes()
      .then(data => { if (!cancelled) { setItems(data); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Ders türleri yüklenemedi.'); setLoading(false); } });

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

  const activeCount = items.filter(x => x.is_active).length;
  const passiveCount = items.length - activeCount;
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');
  const visibleItems = React.useMemo(() => {
    return items
      .filter(item => {
        if (statusFilter === 'active' && !item.is_active) return false;
        if (statusFilter === 'passive' && item.is_active) return false;
        if (!normalizedQuery) return true;
        return item.name.toLocaleLowerCase('tr-TR').includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.name.localeCompare(b.name, 'tr-TR');
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
              aria-label="Ders türü ara"
              placeholder="Ara..."
              disabled={items.length === 0}
            />
          </label>
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Icon.Plus width="14" height="14"/>
            Yeni ders türü
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
            <Icon.Layers width="28" height="28"/>
          </div>
          <div className="lt-empty-title">Henüz ders türü tanımlı değil</div>
          <div className="lt-empty-sub">İlk ders türünü ekleyerek programını şekillendirmeye başla.</div>
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Icon.Plus width="14" height="14"/>
            İlk ders türünü ekle
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
              <span>Eşleşen ders türü bulunamadı.</span>
            </div>
          ) : (
            <div className="lt-grid">
              {visibleItems.map(lt => (
                <LessonTypeCard key={lt.id} lt={lt} onEdit={setModal} />
              ))}
            </div>
          )}
        </>
      )}

      {modal && (
        <LessonTypeModal
          initial={modal === 'new' ? null : modal}
          onSave={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  );
}
