import React from 'react';
import { fmtTL } from '../../data';
import { Icon } from '../../layout';

// Bir ücret kaleminin bedelini KİM karşılıyor — backend'deki
// event_participant_fees.coverage'ın birebir aynası (bkz. 0263_event_fee_coverage.sql).
// Rol yalnızca bir ÖN AYAR seçer; her kalem tek tek değiştirilebilir, çünkü
// gerçek durumlar karışık ("derse para ödemiyor ama kahvaltıya ödüyor",
// "kahvaltısını biz karşılıyoruz", "ücretsiz kontenjandan giriyor").

export const COVERAGE_PRESET_BY_ROLE = {
  regular: 'student',
  invited: 'studio',
  volunteer: 'studio',
};

export const COVERAGE_META = {
  student: {
    label: 'Öğrenci öder',
    tone: '',
    note: 'Katılımcının etkinlik borcuna yazılır.',
  },
  studio: {
    label: 'Stüdyo karşılar',
    tone: 'tone-studio',
    note: 'Bedelini stüdyo üstlenir — kişi yine bu kaleme dahildir.',
  },
  comp: {
    label: 'Ücretsiz kontenjan',
    tone: 'tone-comp',
    note: 'Ücretsiz kontenjandan düşer; kimse ödemez.',
  },
  external: {
    label: 'Kendi öder',
    tone: '',
    note: 'Ücreti yerinde kendisi öder, bize borç yazılmaz.',
  },
  none: {
    label: 'Almıyor',
    tone: '',
    note: 'Bu kalemi almıyor — kişi sayısına da girmez.',
  },
};

// "Stüdyo karşılar" ders ücretinde SUNULMAZ (is_lesson_fee) — bu kalem stüdyonun
// kendi geliridir, üstlenmenin karşılığı gerçek bir masraf değil, sadece tahsil
// edilmeyen bir gelirdir; standart olarak ya alınır ya alınmaz, üçüncü bir hal yok.
// Diğer kalemlerde (kahvaltı vb.) is_pass_through'tan BAĞIMSIZ olarak sunulur —
// dışarıya ödenmese bile stüdyo üstlenebilir.
// "Kendi öder" yalnız dışarıya ödenen kalemlerde anlamlı: stüdyonun kendi
// gelirinde "bize değil kendisi ödesin" diye bir hal yok.
// "Ücretsiz kontenjan" ise ancak kalemde kontenjan tanımlıysa gösterilir.
export function coverageOptionsFor(item) {
  const options = ['student'];
  if (!item.is_lesson_fee) options.push('studio');
  if (item.comp_quota != null) options.push('comp');
  if (item.is_pass_through) options.push('external');
  options.push('none');
  return options;
}

function compRemaining(item, alreadyMine) {
  if (item.comp_quota == null) return null;
  const used = Number(item.comp_used || 0) - (alreadyMine ? 1 : 0);
  return Math.max(0, item.comp_quota - used);
}

/**
 * items: EventFeeItemRow[] (amount, comp_quota, comp_used, is_pass_through)
 * value: { [feeItemId]: coverage }
 * lockedItemIds: ödemesi alınmış — değiştirilemez (backend de reddeder)
 * mineComp: bu katılımcının hâlihazırda comp tuttuğu kalem id'leri (düzenleme akışı)
 */
export function FeeCoverageList({ items, value, onChange, onAmountChange, lockedItemIds, mineComp, disabled }) {
  const locked = lockedItemIds ?? new Set();
  const mine = mineComp ?? new Set();
  const [editingId, setEditingId] = React.useState(null);
  const [draftAmount, setDraftAmount] = React.useState('');
  const [amountError, setAmountError] = React.useState('');

  async function saveAmount(e, id) {
    e.preventDefault();
    const normalized = draftAmount.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(normalized) || Number(normalized) > 9999999999.99) {
      setAmountError('Geçerli bir tutar girin (en fazla iki ondalık).');
      return;
    }
    setAmountError('');
    if (await onAmountChange(id, normalized)) setEditingId(null);
  }

  return (
    <div className="evx-fee-list">
      {items.map((item) => {
        const id = String(item.id);
        const current = value[id] ?? 'student';
        const isLocked = locked.has(id) || disabled;
        const remaining = compRemaining(item, mine.has(id));
        const amount = Number(item.amount);
        const canEditAmount = !!onAmountChange && item.is_lesson_fee && current === 'student' && !locked.has(id);
        const isEditing = editingId === id && canEditAmount;

        return (
          <div className="evx-cov-item" key={id}>
            <div className="evx-cov-head">
              <span className="evx-cov-label">{item.label}</span>
              {item.is_pass_through && <span className="evx-badge tone-role-invited">DIŞARIYA</span>}
              <span className={`evx-cov-amt${current === 'student' ? '' : ' is-off'}`}>{fmtTL(amount)}</span>
              {canEditAmount && (
                <button
                  type="button" className="evx-cov-edit" disabled={disabled}
                  aria-label={`${item.label} tutarını düzenle`}
                  aria-expanded={isEditing}
                  onClick={() => { setEditingId(id); setDraftAmount(String(item.amount).replace('.', ',')); setAmountError(''); }}
                >
                  <Icon.Edit width="16" height="16" aria-hidden="true" />
                </button>
              )}
            </div>
            {isEditing && (
              <form className="evx-cov-editor" onSubmit={(e) => saveAmount(e, id)}>
                <label className="evx-field">
                  <span>Bu katılımcının ders ücreti (TL)</span>
                  <input autoFocus inputMode="decimal" value={draftAmount} disabled={disabled}
                    onChange={(e) => setDraftAmount(e.target.value)} />
                </label>
                <span className="evx-cov-note">Yalnız bu katılımcı için geçerli. Rol değişince özel tutar sıfırlanır.</span>
                {amountError && <span className="evx-cov-error" role="alert">{amountError}</span>}
                <div className="evx-cov-editor-actions">
                  <button type="button" className="evx-btn-secondary" disabled={disabled} onClick={() => setEditingId(null)}>Vazgeç</button>
                  <button type="submit" className="evx-btn-primary evx-btn-accent" disabled={disabled}>{disabled ? 'Kaydediliyor…' : 'Kaydet'}</button>
                </div>
              </form>
            )}
            <div className="evx-cov-opts">
              {coverageOptionsFor(item).map((option) => {
                const meta = COVERAGE_META[option];
                const compFull = option === 'comp' && current !== 'comp' && remaining === 0;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={isLocked || compFull || isEditing}
                    className={`evx-cov-btn${current === option ? ` is-on ${meta.tone}` : ''}`}
                    onClick={() => onChange(id, option)}
                  >
                    {option === 'comp' && remaining != null
                      ? `${meta.label} (${remaining})`
                      : meta.label}
                  </button>
                );
              })}
            </div>
            <span className="evx-cov-note">
              {locked.has(id)
                ? 'Ödemesi alındığı için değiştirilemez.'
                : COVERAGE_META[current].note}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function feeTotals(items, value) {
  let studentDue = 0;
  let studioCovered = 0;
  const compLabels = [];
  for (const item of items) {
    const coverage = value[String(item.id)] ?? 'student';
    const amount = Number(item.amount);
    if (coverage === 'student') studentDue += amount;
    else if (coverage === 'studio') studioCovered += amount;
    else if (coverage === 'comp') compLabels.push(item.label);
  }
  return { studentDue, studioCovered, compLabels };
}

export function FeeCoverageTotals({ items, value }) {
  const { studentDue, studioCovered, compLabels } = feeTotals(items, value);
  return (
    <div className="evx-cov-total">
      <div className="evx-cov-total-row">
        <span>Katılımcıdan alınacak</span>
        <span className="val">{fmtTL(studentDue)}</span>
      </div>
      {studioCovered > 0 && (
        <div className="evx-cov-total-row is-muted">
          <span>Stüdyonun üstleneceği</span>
          <span className="val">{fmtTL(studioCovered)}</span>
        </div>
      )}
      {compLabels.length > 0 && (
        <div className="evx-cov-total-row is-muted">
          <span>Ücretsiz kontenjandan</span>
          <span className="val">{compLabels.join(', ')}</span>
        </div>
      )}
    </div>
  );
}
