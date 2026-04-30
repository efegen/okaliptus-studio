import React from 'react';
import { getLessonTypes, createLessonType, updateLessonType } from './api';
import { Icon } from './layout';

function formatPriceTRY(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  const hasFraction = Math.abs(n - Math.trunc(n)) > 0.0001;
  return `₺${n.toLocaleString('tr-TR', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

const EMPTY_FORM = { name: '', default_duration_minutes: '60', default_price: '' };

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
      <div className="modal">
        <h3>{isNew ? 'Yeni Ders Türü' : 'Ders Türünü Düzenle'}</h3>

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
              <label>Varsayılan Fiyat (₺)</label>
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
              <div className="lt-status-toggle">
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
  return (
    <div className={'lt-card' + (lt.is_active ? '' : ' lt-card-passive')}>
      <div className="lt-card-head">
        <span className={'pill ' + (lt.is_active ? 'pill-sage' : 'pill-neutral')}>
          {lt.is_active ? 'Aktif' : 'Pasif'}
        </span>
        <button className="lt-edit-btn" onClick={() => onEdit(lt)} aria-label="Düzenle">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          </svg>
          Düzenle
        </button>
      </div>

      <div className="lt-card-name">{lt.name}</div>

      <div className="lt-card-meta">
        <div className="lt-meta-item">
          <span className="lt-meta-label">Süre</span>
          <span className="lt-meta-value">{lt.default_duration_minutes} dk</span>
        </div>
        <div className="lt-meta-sep" />
        <div className="lt-meta-item">
          <span className="lt-meta-label">Varsayılan fiyat</span>
          <span className="lt-meta-price">{formatPriceTRY(lt.default_price)}</span>
        </div>
      </div>
    </div>
  );
}

export function LessonTypesPage() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [modal, setModal] = React.useState(null); // null | 'new' | lessonTypeObj

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

  return (
    <div className="page settings-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{activeCount} aktif · {items.length} toplam</div>
          <h1 className="page-title">Ders Türleri</h1>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Icon.Plus width="14" height="14"/>
            Yeni Ders Türü
          </button>
        </div>
      </div>

      {loading ? (
        <div className="stg-loading">Yükleniyor…</div>
      ) : error ? (
        <div className="stg-feedback stg-feedback-err">{error}</div>
      ) : items.length === 0 ? (
        <div className="lt-empty">
          <div className="lt-empty-icon">
            <Icon.Repeat width="32" height="32"/>
          </div>
          <div className="lt-empty-text">Henüz ders türü tanımlı değil.</div>
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            İlk ders türünü ekle
          </button>
        </div>
      ) : (
        <div className="lt-grid">
          {items.map(lt => (
            <LessonTypeCard key={lt.id} lt={lt} onEdit={setModal} />
          ))}
        </div>
      )}

      {modal && (
        <LessonTypeModal
          initial={modal === 'new' ? null : modal}
          onSave={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
