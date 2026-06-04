import React from 'react';
import {
  getLessonTypes,
  createLessonType,
  updateLessonType,
  getStudents,
  getLessonTypeStudentPrices,
  setLessonTypeStudentPrice,
  removeLessonTypeStudentPrice,
} from './api';
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

function studentLabel(row) {
  const nick = row.nickname || row.student_nickname;
  return nick ? `${row.full_name} (${nick})` : row.full_name;
}

// Tek bir özel fiyat satırı — yerel düzenlenebilir tutar + Kaydet/Kaldır.
function PriceRow({ row, busy, onSave, onRemove }) {
  const [val, setVal] = React.useState(() => String(Number(row.custom_price)));
  React.useEffect(() => { setVal(String(Number(row.custom_price))); }, [row.custom_price]);

  const parsed = parseFloat(val);
  const dirty = !(Number.isFinite(parsed) && Math.abs(parsed - Number(row.custom_price)) < 0.001);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  return (
    <div className="ltp-row">
      <span className="ltp-row-name">{studentLabel(row)}</span>
      <input
        type="number" min={0} step="0.01"
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
        disabled={busy}
        aria-label={`${row.full_name} özel fiyat`}
      />
      <button
        type="button" className="btn btn-ghost btn-xs"
        disabled={busy || !dirty || !valid}
        onClick={() => onSave(row.student_id, parsed)}
      >
        Kaydet
      </button>
      <button
        type="button" className="btn btn-ghost btn-xs"
        disabled={busy}
        onClick={() => onRemove(row.student_id)}
      >
        Kaldır
      </button>
    </div>
  );
}

// Ders türüne özel öğrenci fiyatları (migration 0238). 0 = ücretsiz. Yalnız
// bundan sonra oluşturulacak dersleri etkiler (price_snapshot create anında).
function LessonTypePrices({ lessonTypeId }) {
  const [prices, setPrices] = React.useState([]);
  const [students, setStudents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [newStudentId, setNewStudentId] = React.useState('');
  const [newPrice, setNewPrice] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([getLessonTypeStudentPrices(lessonTypeId), getStudents()])
      .then(([p, s]) => { if (!cancelled) { setPrices(p); setStudents(s); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message || 'Yüklenemedi.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [lessonTypeId]);

  async function refresh() {
    const p = await getLessonTypeStudentPrices(lessonTypeId);
    setPrices(p);
  }

  const overriddenIds = new Set(prices.map(p => String(p.student_id)));
  const available = students
    .filter(s => s.is_active !== false && !overriddenIds.has(String(s.id)))
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'tr-TR'));

  async function handleAdd() {
    const price = parseFloat(newPrice);
    if (!newStudentId) { setError('Öğrenci seç.'); return; }
    if (!Number.isFinite(price) || price < 0) { setError('Geçerli bir fiyat gir.'); return; }
    setBusy(true); setError(null);
    try {
      await setLessonTypeStudentPrice(lessonTypeId, newStudentId, price);
      setNewStudentId(''); setNewPrice('');
      await refresh();
    } catch (e) { setError(e.message || 'Eklenemedi.'); }
    finally { setBusy(false); }
  }

  async function handleSave(studentId, price) {
    setBusy(true); setError(null);
    try {
      await setLessonTypeStudentPrice(lessonTypeId, studentId, price);
      await refresh();
    } catch (e) { setError(e.message || 'Kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function handleRemove(studentId) {
    setBusy(true); setError(null);
    try {
      await removeLessonTypeStudentPrice(lessonTypeId, studentId);
      await refresh();
    } catch (e) { setError(e.message || 'Kaldırılamadı.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="ltp-section">
      <div className="ltp-head">
        <span className="eyebrow">Özel fiyatlı öğrenciler</span>
        <span className="ltp-hint">0 = ücretsiz · yalnız yeni dersleri etkiler</span>
      </div>

      {loading ? (
        <div className="ltp-state">Yükleniyor…</div>
      ) : (
        <>
          {prices.length > 0 && (
            <div className="ltp-list">
              {prices.map(row => (
                <PriceRow
                  key={row.student_id}
                  row={row}
                  busy={busy}
                  onSave={handleSave}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}

          <div className="ltp-add">
            <select
              value={newStudentId}
              onChange={e => setNewStudentId(e.target.value)}
              disabled={busy || available.length === 0}
              aria-label="Öğrenci seç"
            >
              <option value="">
                {available.length === 0 ? 'Eklenecek öğrenci yok' : 'Öğrenci seç…'}
              </option>
              {available.map(s => (
                <option key={s.id} value={s.id}>{studentLabel(s)}</option>
              ))}
            </select>
            <input
              type="number" min={0} step="0.01"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
              placeholder="Fiyat (₺)"
              disabled={busy || !newStudentId}
              aria-label="Özel fiyat"
            />
            <button
              type="button" className="btn btn-ghost btn-xs"
              onClick={handleAdd}
              disabled={busy || !newStudentId}
            >
              Ekle
            </button>
          </div>
        </>
      )}

      {error && <div className="stg-feedback stg-feedback-err" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function LessonTypeModal({ initial, onSave, onClose }) {
  const isNew = !initial;
  const [form, setForm] = React.useState(
    initial
      ? { name: initial.name, default_duration_minutes: String(initial.default_duration_minutes), default_price: String(initial.default_price) }
      : { ...EMPTY_FORM }
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
        : await updateLessonType(initial.id, { name, default_duration_minutes: dur, default_price: price });
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

          {!isNew && <LessonTypePrices lessonTypeId={initial.id} />}

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
  const className = `lt-card lt-tone-${tone}`;

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

  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');
  const visibleItems = React.useMemo(() => {
    return items
      .filter(item => {
        if (!normalizedQuery) return true;
        return item.name.toLocaleLowerCase('tr-TR').includes(normalizedQuery);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
  }, [items, normalizedQuery]);

  return (
    <section className="catalog-section">
      <div className="catalog-section-head">
        <div className="eyebrow">{items.length} ders türü</div>
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
      ) : visibleItems.length === 0 ? (
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
