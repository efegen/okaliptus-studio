import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { createEvent } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';

// Canvas-2 "8a" — Etkinlik oluştur. Şablon seçimi bu turda yok (backend'de
// şablon kavramı henüz yok).
//
// Her ücret kaleminde iki ek ayar var (migration 0263):
//  · "Dışarıya ödenecek": para stüdyonun geliri değil, üçüncü tarafa (restoran)
//    aktarılacak. Kişi sayısı ve stüdyonun üstlendiği tutar bu kalemlerde kritik.
//  · "Ücretsiz kontenjan": tedarikçinin bedava verdiği kişi sayısı. Katılımcı
//    eklerken bu kontenjandan düşülebilir ve dolunca backend eklemeyi reddeder.

function toLocalInputParts(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function normalizeDecimalInput(value) {
  const cleaned = value.replace(/[^0-9.,]/g, '').replace(',', '.');
  const [whole, ...fractions] = cleaned.split('.');
  return fractions.length === 0 ? whole : `${whole}.${fractions.join('').slice(0, 2)}`;
}

export function MobileEventCreate({ onClose, onCreated }) {
  const queryClient = useQueryClient();
  const defaultDate = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(9, 30, 0, 0);
    return d;
  }, []);
  const defaults = toLocalInputParts(defaultDate);

  const [name, setName] = React.useState('');
  const [dateStr, setDateStr] = React.useState(defaults.date);
  const [timeStr, setTimeStr] = React.useState(defaults.time);
  const [location, setLocation] = React.useState('');
  const [feeItems, setFeeItems] = React.useState([
    { label: 'Ders ücreti', amount: '', isPassThrough: false, compQuota: '', isLessonFee: true },
  ]);
  const [capacityOn, setCapacityOn] = React.useState(false);
  const [capacity, setCapacity] = React.useState(40);
  const [transportEnabled, setTransportEnabled] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  function updateFeeItem(index, patch) {
    setFeeItems((items) => items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function addFeeItemRow() {
    setFeeItems((items) => [...items, { label: '', amount: '', isPassThrough: false, compQuota: '', isLessonFee: false }]);
  }
  function removeFeeItemRow(index) {
    setFeeItems((items) => items.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError('');
    const trimmedName = name.trim();
    if (!trimmedName) return setError('Etkinlik adı zorunlu.');
    if (!dateStr || !timeStr) return setError('Tarih ve saat zorunlu.');
    const validItems = feeItems.filter((it) => it.label.trim() && it.amount !== '');
    for (const it of validItems) {
      if (!Number.isFinite(Number(normalizeDecimalInput(it.amount))) || Number(normalizeDecimalInput(it.amount)) < 0) {
        return setError(`"${it.label}" için geçerli bir tutar girin.`);
      }
    }

    setSubmitting(true);
    try {
      const startsAt = new Date(`${dateStr}T${timeStr}:00`).toISOString();
      const event = await createEvent({
        name: trimmedName,
        startsAt,
        location: location.trim() || null,
        capacityLimit: capacityOn ? capacity : null,
        transportEnabled,
        note: note.trim() || null,
        feeItems: validItems.map((it) => ({
          label: it.label.trim(),
          amount: normalizeDecimalInput(it.amount),
          isPassThrough: it.isLessonFee ? false : !!it.isPassThrough,
          compQuota: it.compQuota === '' ? null : Number(it.compQuota),
          isLessonFee: !!it.isLessonFee,
        })),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events() });
      onCreated(event);
    } catch (err) {
      setError(err?.message || 'Etkinlik oluşturulamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <div className="evx-header-mid">
          <span className="evx-header-title">Yeni etkinlik</span>
          <span className="evx-header-sub">Ücretsiz etkinlikte ücret alanını boş bırakabilirsiniz</span>
        </div>
        <button type="button" className="evx-header-btn is-outline" onClick={onClose} title="Kapat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div className="evx-body">
        <div className="evx-section">
          <span className="evx-section-label">Etkinlik</span>
          <div className="evx-field is-active">
            <span className="evx-field-label">ETKİNLİK ADI</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="örn. Gün Doğumu Yogası" maxLength={120} />
          </div>
          <div className="evx-field-grid">
            <div className="evx-field">
              <span className="evx-field-label">TARİH</span>
              <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </div>
            <div className="evx-field">
              <span className="evx-field-label">SAAT</span>
              <input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
            </div>
          </div>
          <div className="evx-field">
            <span className="evx-field-label">YER</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="İsteğe bağlı" maxLength={200} />
          </div>
        </div>

        <div className="evx-section">
          <span className="evx-section-label">Fiyat kalemleri</span>
          <div className="evx-fee-list">
            {feeItems.map((item, index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <div className="evx-fee-row">
                  <input
                    className="evx-fee-row-label"
                    style={{ border: 0, background: 'none', outline: 'none', color: 'inherit', fontWeight: 500, fontSize: 14 }}
                    value={item.label}
                    onChange={(e) => updateFeeItem(index, { label: e.target.value })}
                    placeholder="Kalem adı"
                    maxLength={60}
                  />
                  <input
                    className="evx-fee-row-amt"
                    style={{ border: 0, background: 'none', outline: 'none', color: 'inherit', width: 70, textAlign: 'right' }}
                    value={item.amount}
                    onChange={(e) => updateFeeItem(index, { amount: normalizeDecimalInput(e.target.value) })}
                    placeholder="0"
                    inputMode="decimal"
                  />
                  {!item.isLessonFee && (
                    <button type="button" onClick={() => removeFeeItemRow(index)} aria-label="Kalemi kaldır"
                      style={{ border: 0, background: 'none', color: 'var(--ink-4)', padding: 0, minHeight: 0 }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </div>
                <div className="evx-fee-row-meta">
                  {item.isLessonFee ? (
                    <span className="evx-hint" style={{ padding: 0 }}>Ders ücreti stüdyonun kendi geliridir — sadece alınır ya da alınmaz</span>
                  ) : (
                    <button
                      type="button"
                      className={`evx-mini-toggle${item.isPassThrough ? ' is-on' : ''}`}
                      onClick={() => updateFeeItem(index, { isPassThrough: !item.isPassThrough })}
                    >
                      {item.isPassThrough ? '✓ ' : ''}Dışarıya ödenecek
                    </button>
                  )}
                  <label className="evx-mini-field">
                    Ücretsiz kontenjan
                    <input
                      value={item.compQuota}
                      onChange={(e) => updateFeeItem(index, { compQuota: e.target.value.replace(/[^0-9]/g, '') })}
                      placeholder="—"
                      inputMode="numeric"
                      aria-label={`${item.label || 'Kalem'} ücretsiz kontenjanı`}
                    />
                  </label>
                </div>
              </div>
            ))}
            <button type="button" className="evx-add-dashed" onClick={addFeeItemRow}>
              <Icon.Plus width="15" height="15" />
              Kalem ekle (kahvaltı, ekipman, ulaşım…)
            </button>
          </div>
          <p className="evx-hint">
            "Dışarıya ödenecek" = para stüdyonun geliri değil (örn. restorana giden kahvaltı payı) ·
            ücretsiz kontenjan boş bırakılırsa o kalemde bedava yer yok
          </p>
        </div>

        <div className="evx-section">
          <span className="evx-section-label">Katılım</span>
          <div className="evx-toggle-row" style={{ borderRadius: capacityOn ? '14px 14px 0 0' : 14, borderBottom: capacityOn ? 0 : undefined }}>
            <div className="evx-toggle-body">
              <span className="evx-toggle-title">Kontenjan sınırı</span>
              <span className="evx-toggle-sub">Dolunca yeni kişi eklenemez</span>
            </div>
            <input type="checkbox" className="evx-toggle" checked={capacityOn} onChange={(e) => setCapacityOn(e.target.checked)} />
          </div>
          {capacityOn && (
            <div className="evx-stepper" style={{ marginTop: -8, borderRadius: '0 0 14px 14px', borderTop: '1px dashed var(--line)' }}>
              <button type="button" className="evx-stepper-btn" onClick={() => setCapacity((c) => Math.max(1, c - 1))}>−</button>
              <span className="evx-stepper-val">{capacity}</span>
              <button type="button" className="evx-stepper-btn" onClick={() => setCapacity((c) => c + 1)}>+</button>
              <span className="evx-stepper-unit">kişi</span>
            </div>
          )}
          <div className="evx-toggle-row">
            <div className="evx-toggle-body">
              <span className="evx-toggle-title">Ulaşım planı aç</span>
              <span className="evx-toggle-sub">Araçlar ve yerleştirme takip edilir</span>
            </div>
            <input type="checkbox" className="evx-toggle" checked={transportEnabled} onChange={(e) => setTransportEnabled(e.target.checked)} />
          </div>
        </div>

        <div className="evx-field">
          <span className="evx-field-label">NOT</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı · örn. mat getirin…" rows={2} maxLength={500} />
        </div>

        {error && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{error}</div>}
      </div>

      <div className="evx-footer">
        <button type="button" className="evx-btn-primary" onClick={handleSubmit} disabled={submitting}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M5 13l4 4 10-10" /></svg>
          {submitting ? 'Oluşturuluyor…' : 'Etkinliği oluştur'}
        </button>
        <p className="evx-footer-note">Oluşturunca boş katılımcı listesi açılır · kişileri sonra eklersiniz</p>
      </div>
    </div>
  );
}
