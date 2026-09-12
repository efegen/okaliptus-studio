import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { fmtTL } from '../../data';
import { searchEventDay } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import {
  PAYMENT_METHODS,
  amountDigits,
  breakfastOptionsFor,
  defaultBreakfastFor,
  formatPhoneDisplay,
  formatPhoneMask,
  fullAmountFor,
  isCompletePhone,
  phoneDigitsFromInput,
  samePhone,
  toNumber,
  validateEntryDraft,
} from './eventDayUtils';

// Etkinlik günü kişi ekranı (bkz. MobileEventDay.jsx) — tam sayfa (pop-up
// değil), kalabalıkta hızlı dokunuş için. Dört kip:
//   student       — aramadan seçilen kayıtlı öğrenci için yeni satır
//   light         — "yeni kişi": ad soyad + maskeli telefon, hafif kayıt
//                   (öğrenci listesine düşmez)
//   breakfastOnly — "yeni kahvaltı misafiri" (bkz. MobileEventDayBreakfast):
//                   derse hiç katılmıyor, öğrenci olamaz — hafif kaydın
//                   kahvaltıya kilitli bir alt hali
//   edit          — listedeki satırın düzenlenmesi (hafif kayıtta ad/telefon
//                   da, sadece-kahvaltı satırında kısıtlar aynen uygulanır)
// Sıra kapıdaki akışı izler: yöntem → kahvaltı → tutar. Kahvaltı tek düz
// seçim listesi — "almayacak" diğerleriyle eşit bir seçenek (sadece-kahvaltı
// kipinde bu seçenek hiç gösterilmez). "Tam ödeme" ile doldurulan tutar,
// yöntem/kahvaltı sonradan değişirse onu izler; elle yazılan tutara
// dokunulmaz.

const TIME_FMT = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

function timeOf(value) {
  return value ? TIME_FMT.format(new Date(value)) : '';
}

function targetKeyOf(target) {
  if (!target) return '';
  if (target.mode === 'edit') return `edit:${target.entry.id}`;
  if (target.mode === 'student') return `student:${target.student.student_id}`;
  if (target.mode === 'breakfastOnly') return `breakfastOnly:${target.name ?? ''}:${target.phone ?? ''}`;
  return `light:${target.name ?? ''}:${target.phone ?? ''}`;
}

function initialDraft(target, pricing) {
  const hasBreakfast = pricing?.breakfastFee != null;
  if (target?.mode === 'edit') {
    const { entry } = target;
    return {
      name: entry.full_name || '',
      phone: entry.is_light ? (entry.phone || '') : '',
      method: entry.payment_method || null,
      breakfast: entry.breakfast,
      // Kayıtlı satırdaki seçim bilinçlidir; yöntem değişince kendiliğinden değişmesin.
      breakfastTouched: true,
      // Yalnız 'paid_to_restaurant' kahvaltısında anlam taşır (bkz. backend
      // CHECK) — diğerlerinde entry.breakfast_confirmed_at zaten hep boştur.
      breakfastConfirmed: entry.breakfast_confirmed_at != null,
      amount: String(Math.round(toNumber(entry.amount))),
      amountFromFull: false,
      note: entry.note || '',
    };
  }
  const isNewLightRecord = target?.mode === 'light' || target?.mode === 'breakfastOnly';
  return {
    name: isNewLightRecord ? (target.name || '') : '',
    phone: isNewLightRecord ? (target.phone || '') : '',
    method: null,
    // Gelenlerin çoğu kahvaltı alıyor — varsayılan "bize ödedi" gelir.
    breakfast: hasBreakfast ? 'paid_to_us' : 'none',
    breakfastTouched: false,
    breakfastConfirmed: false,
    amount: '',
    amountFromFull: false,
    note: '',
  };
}

// Maskeli TR cep numarası alanı — serbest metin değil: yalnız 5 ile başlayan
// 10 hane girilebilir, görünüm `0 (5__) ___ __ __`.
export function PhoneField({ digits, onChange, disabled }) {
  const formatted = formatPhoneMask(digits);
  return (
    <div className="evx-field">
      <span className="evx-field-label">TELEFON <small>(isteğe bağlı)</small></span>
      <input
        value={formatted}
        onChange={(event) => {
          const raw = event.target.value;
          let next = phoneDigitsFromInput(raw);
          // Biçim karakteri (boşluk/parantez) silinince rakamlar değişmez;
          // silme niyetini son rakamı silerek karşıla.
          if (raw.length < formatted.length && next === digits) next = digits.slice(0, -1);
          onChange(next);
        }}
        placeholder="0 (5__) ___ __ __"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Telefon"
        disabled={disabled}
      />
    </div>
  );
}

export function EventDayEntrySheet({
  eventId, target, pricing, busy, error, onClose, onSubmit, onDelete, onPickExisting,
}) {
  const targetKey = targetKeyOf(target);
  const [draft, setDraft] = React.useState(() => initialDraft(target, pricing));
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // Ekran yalnız başka bir kişi/satır için açılınca sıfırlanır — liste
  // arkada 5 sn'de bir yenilenirken yazılanlar kaybolmasın.
  React.useEffect(() => {
    setDraft(initialDraft(target, pricing));
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  if (!target) return null;

  const isEdit = target.mode === 'edit';
  const entry = isEdit ? target.entry : null;
  const isLight = target.mode === 'light' || target.mode === 'breakfastOnly' || Boolean(entry?.is_light);
  // Derse hiç katılmıyor, öğrenci olamaz — hafif kaydın kahvaltıya kilitli
  // hali (bkz. migration 0286). Oluşturulduktan sonra değişmez, bu yüzden
  // edit'te de target değil entry'nin kendi bayrağına bakılır.
  const isBreakfastOnly = target.mode === 'breakfastOnly' || Boolean(entry?.breakfast_only);
  const hasBreakfast = pricing?.breakfastFee != null;
  const effectiveBreakfast = hasBreakfast ? draft.breakfast : 'none';
  const fullAmount = fullAmountFor(pricing, effectiveBreakfast, { skipLesson: isBreakfastOnly });
  // Yazılan tutar beklenenden fazlaysa (fazladan bir sıfır/hane gibi kapıda
  // sık yapılan bir yazım hatası) uyarır — engellemez, çünkü bahşiş ya da
  // birden fazla kişinin parasını tek satırda toplama gibi meşru durumlar da
  // var. Kısmi/az ödeme ise zaten serbest (bkz. spec "Fazla ödeme"), o yönde
  // uyarmaz.
  const amountMismatch = draft.amount !== '' && !draft.amountFromFull
    && fullAmount > 0 && toNumber(draft.amount) > fullAmount;
  const problem = validateEntryDraft({
    amount: draft.amount,
    method: draft.method,
    breakfast: effectiveBreakfast,
    pricing,
    isLight,
    name: draft.name,
    phone: draft.phone,
  });

  // Yazılan numara başka birinde kayıtlıysa uyar — kargaşada aynı kişinin
  // ikinci kez eklenmesini en çok bu engeller.
  const phoneComplete = isLight && isCompletePhone(draft.phone);
  const phoneCheck = useQuery({
    queryKey: queryKeys.eventDaySearch(eventId, draft.phone),
    queryFn: () => searchEventDay(eventId, draft.phone),
    enabled: phoneComplete,
    staleTime: 10 * 1000,
  });
  const phoneMatch = phoneComplete
    ? (phoneCheck.data ?? []).find((row) => samePhone(row.phone, draft.phone)
      && String(row.entry_id ?? '') !== String(entry?.id ?? ''))
    : null;

  function applyFullAmount(next) {
    if (!next.amountFromFull) return next;
    const breakfast = hasBreakfast ? next.breakfast : 'none';
    return { ...next, amount: String(fullAmountFor(pricing, breakfast, { skipLesson: isBreakfastOnly })) };
  }

  function update(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function selectMethod(method) {
    setDraft((current) => applyFullAmount({
      ...current,
      method,
      breakfast: current.breakfastTouched ? current.breakfast : defaultBreakfastFor(method),
    }));
  }

  function selectBreakfast(breakfast) {
    setDraft((current) => applyFullAmount({ ...current, breakfast, breakfastTouched: true }));
  }

  function fillFullAmount() {
    setDraft((current) => applyFullAmount({ ...current, amountFromFull: true }));
  }

  function submit() {
    if (busy || problem) return;
    const amount = String(toNumber(draft.amount));
    // breakfastConfirmed yalnız anlamlı bir talimat olduğunda gönderilir:
    // onaylanıyor (true) ya da daha önce onaylıydı da şimdi geri alınıyor
    // (false + wasConfirmed). Hiç dokunulmamış varsayılan durumda hiç
    // gönderilmez — kahvaltı türü değişmişse backend zaten kendi temizler,
    // göndermek geçersiz kombinasyon (validation hatası) yaratır.
    const wasConfirmed = isEdit && entry?.breakfast_confirmed_at != null;
    const money = {
      amount,
      paymentMethod: toNumber(amount) > 0 ? draft.method : null,
      breakfast: effectiveBreakfast,
      note: draft.note.trim() || null,
      ...(effectiveBreakfast === 'paid_to_restaurant' && (draft.breakfastConfirmed || wasConfirmed)
        ? { breakfastConfirmed: draft.breakfastConfirmed }
        : {}),
    };
    const identity = { fullName: draft.name.trim(), phone: draft.phone || null };
    if (target.mode === 'student') onSubmit({ studentId: target.student.student_id, ...money });
    else if (target.mode === 'light') onSubmit({ ...identity, ...money });
    else if (target.mode === 'breakfastOnly') onSubmit({ ...identity, ...money, breakfastOnly: true });
    else onSubmit({ ...money, ...(isLight ? identity : {}) });
  }

  function handleClose() {
    if (!busy) onClose();
  }

  let title = target.mode === 'breakfastOnly' ? 'Yeni kahvaltı misafiri' : 'Yeni kişi';
  let subtitle = target.mode === 'breakfastOnly'
    ? 'Yalnız kahvaltı için — derse dahil değil, öğrenci listesine eklenmez'
    : 'Yalnız bu etkinlikte — öğrenci listesine eklenmez';
  if (target.mode === 'student') {
    title = target.student.full_name;
    subtitle = target.student.phone ? formatPhoneDisplay(target.student.phone) : 'Telefon kayıtlı değil';
  } else if (isEdit) {
    title = entry.full_name;
    subtitle = `Ekleyen ${entry.created_by_name || '—'} · ${timeOf(entry.created_at)}`;
  } else if (draft.name.trim()) {
    title = draft.name.trim();
  }
  const preRegistered = target.mode === 'student' ? target.student.pre_registered : entry?.pre_registered;
  const lessonFee = toNumber(pricing?.lessonFee);

  const metaParts = [];
  if (isEdit && entry.updated_by_name && entry.updated_at !== entry.created_at) {
    metaParts.push(`Son değiştiren ${entry.updated_by_name} · ${timeOf(entry.updated_at)}`);
  }
  if (isEdit && entry.checked_at) metaParts.push(`✓ Kontrol eden ${entry.checked_by_name || '—'}`);

  let problemView = null;
  if (error) {
    problemView = <div className="evx-action-sheet-error" role="alert">{error}</div>;
  } else if (problem && (problem.code === 'breakfast' || problem.code === 'phone')) {
    problemView = <div className="evx-action-sheet-error" role="alert">{problem.message}</div>;
  } else if (problem) {
    problemView = <p className="evx-hint">{problem.message}</p>;
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={handleClose} title="Geri" aria-label="Geri">
          <Icon.ChevronL width="22" height="22" />
        </button>
        <div className="evx-header-mid">
          <span className="evx-header-title">{title}</span>
          <span className="evx-header-sub">{subtitle}</span>
        </div>
        {preRegistered && <span className="evx-badge tone-neutral evx-badge-sm">ÖN KAYITLI</span>}
        {isBreakfastOnly && <span className="evx-badge tone-guest evx-badge-sm">SADECE KAHVALTI</span>}
      </header>

      <div className="evx-body">
        {isLight && (
          <div className="evd-identity">
            <div className="evx-field is-active">
              <span className="evx-field-label">AD SOYAD</span>
              <input
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="Ad Soyad"
                autoComplete="off"
                aria-label="Ad soyad"
                disabled={busy}
              />
            </div>
            <PhoneField digits={draft.phone} onChange={(phone) => update({ phone })} disabled={busy} />
            {phoneMatch && (
              <div className="evd-warn" role="status">
                <span>
                  Bu numara <strong>{phoneMatch.full_name}</strong> adına{' '}
                  {phoneMatch.entry_id ? 'listede zaten var' : 'kayıtlı'}.
                </span>
                {!isEdit && onPickExisting && (
                  <button
                    type="button"
                    className="evd-warn-btn"
                    onClick={() => onPickExisting(phoneMatch)}
                    disabled={busy}
                  >
                    {phoneMatch.entry_id ? 'Kaydı aç' : 'Onu seç'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="evx-section">
          <span className="evx-section-label">Ödeme yöntemi</span>
          <div className="evx-seg" role="group" aria-label="Ödeme yöntemi">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method.id}
                type="button"
                className={`evx-seg-btn${draft.method === method.id ? ' is-on' : ''}`}
                aria-pressed={draft.method === method.id}
                onClick={() => selectMethod(method.id)}
                disabled={busy}
              >
                {method.label}
              </button>
            ))}
          </div>
        </div>

        {hasBreakfast && (
          <div className="evx-section">
            <span className="evx-section-label">Kahvaltı</span>
            <div className="evx-choice evd-breakfast-choice" role="group" aria-label="Kahvaltı">
              {breakfastOptionsFor(isBreakfastOnly).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`evx-choice-btn${draft.breakfast === option.id ? ' is-on' : ''}`}
                  aria-pressed={draft.breakfast === option.id}
                  onClick={() => selectBreakfast(option.id)}
                  disabled={busy}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="evx-hint">Bize ödendiğinde {fmtTL(toNumber(pricing.breakfastFee))} restorana biz öderiz.</p>

            {draft.breakfast === 'paid_to_restaurant' && (
              <div className={`evx-toggle-row${draft.breakfastConfirmed ? '' : ' evd-breakfast-pending'}`}>
                <div className="evx-toggle-body">
                  <span className="evx-toggle-title">Kahvaltı fişi verildi</span>
                  <span className="evx-toggle-sub">
                    {draft.breakfastConfirmed
                      ? (isEdit && entry?.breakfast_confirmed_by_name && entry.breakfast_confirmed_at
                        ? `${entry.breakfast_confirmed_by_name} · ${timeOf(entry.breakfast_confirmed_at)}`
                        : 'Restoran fişi görüldü, kahvaltı fişi verildi')
                      : 'Henüz gelmedi — restoran fişini getirince açın'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="evx-toggle"
                  checked={draft.breakfastConfirmed}
                  onChange={(event) => update({ breakfastConfirmed: event.target.checked })}
                  aria-label="Kahvaltı fişi verildi"
                  disabled={busy}
                />
              </div>
            )}
          </div>
        )}

        <div className="evx-section">
          <span className="evx-section-label">Alınan tutar</span>
          <div className="evd-amount-row">
            <label className={`evd-amount-field${amountMismatch ? ' is-warn' : ''}`}>
              <input
                value={draft.amount}
                onChange={(event) => update({ amount: amountDigits(event.target.value), amountFromFull: false })}
                inputMode="numeric"
                placeholder="0"
                aria-label="Alınan tutar"
                disabled={busy}
              />
              <span aria-hidden="true">₺</span>
            </label>
            <button
              type="button"
              className={`evd-full-btn${draft.amountFromFull ? ' is-on' : ''}`}
              onClick={fillFullAmount}
              disabled={busy || fullAmount <= 0}
            >
              <span>Tam ödeme</span>
              <strong>{fmtTL(fullAmount)}</strong>
            </button>
          </div>
          <p className={`evx-hint${amountMismatch ? ' evd-amount-mismatch' : ''}`}>
            {amountMismatch && <strong>Beklenenden fazla — tam ödeme {fmtTL(fullAmount)} olmalı. </strong>}
            {isBreakfastOnly ? (
              <>
                {effectiveBreakfast === 'paid_to_us' && `Kahvaltı ${fmtTL(toNumber(pricing?.breakfastFee))}`}
                {effectiveBreakfast === 'paid_to_restaurant' && 'Kahvaltıyı restorana kendisi öder'}
                {effectiveBreakfast === 'free' && 'Kahvaltıyı stüdyo öder'}
              </>
            ) : (
              <>
                Ders {fmtTL(lessonFee)}
                {effectiveBreakfast === 'paid_to_us' ? ` + kahvaltı ${fmtTL(toNumber(pricing?.breakfastFee))}` : ''}
                {effectiveBreakfast === 'paid_to_restaurant' ? ' · kahvaltıyı restorana kendisi öder' : ''}
                {effectiveBreakfast === 'free' ? ' · kahvaltıyı stüdyo öder' : ''}
              </>
            )}
          </p>
        </div>

        <div className="evx-field">
          <span className="evx-field-label">NOT <small>(isteğe bağlı)</small></span>
          <input
            value={draft.note}
            onChange={(event) => update({ note: event.target.value.slice(0, 500) })}
            placeholder="Örn. annesi ödedi, IBAN'ı sonra atacak"
            aria-label="Not"
            disabled={busy}
          />
        </div>

        {metaParts.length > 0 && <p className="evd-meta">{metaParts.join(' · ')}</p>}

        {problemView}

        {isEdit && onDelete && (
          confirmDelete ? (
            <div className="evd-delete-confirm" role="group" aria-label="Silme onayı">
              <span>Bu kayıt listeden silinsin mi?</span>
              <button type="button" className="evd-delete-no" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Hayır
              </button>
              <button type="button" className="evd-delete-yes" onClick={() => onDelete(entry)} disabled={busy}>
                Evet, sil
              </button>
            </div>
          ) : (
            <button type="button" className="evd-delete-link" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Icon.Trash width="15" height="15" aria-hidden="true" /> Kaydı sil
            </button>
          )
        )}
      </div>

      <footer className="evx-footer">
        <button type="button" className="evx-btn-primary" onClick={submit} disabled={busy || Boolean(problem)}>
          {busy ? 'Kaydediliyor…' : (
            <><Icon.Check width="17" height="17" aria-hidden="true" /> {isEdit ? 'Kaydet' : 'Listeye ekle'}</>
          )}
        </button>
      </footer>
    </div>
  );
}
