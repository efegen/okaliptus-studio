import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { fmtTL } from '../../data';
import {
  getEventById, getEventParticipants, getEventParticipantFees, getEventVehicles,
  updateEventParticipant, updateEventParticipantFee, recordEventParticipantPayment,
  getEventParticipantPayments, cancelEventParticipantPayment, removeEventParticipant,
} from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { FeeCoverageList, FeeCoverageTotals } from './feeCoverage';

// Etkinliğe özel katılımcı profili — Claude Design "Canvas-4" ekran "2a"
// (bkz. design_handoff_katilimci_profili/). Koyu "hero" başlık + bilgi kartı
// (Rol/Ulaşım/Ödeme) + misafirler + not, sabit alt barda Ara/Ödeme al.
//
// Kişi başı koltuk numarası tutulmaz; araçta yalnız toplam yolcu koltuğu vardır.
// Tahsilatların tarih/yöntem ve iade-iptal geçmişi event_payments defterindedir.
//
// Öğrencinin genel profiliyle KARIŞTIRILMAZ — burada yalnız bu kişinin BU
// etkinlikteki durumu var, genel borç/ders geçmişi yok.

const ROLES = [
  ['regular', 'Normal'],
  ['invited', 'Davetli'],
  ['volunteer', 'Gönüllü'],
];
const ROLE_CHIP_LABEL = { regular: 'Normal', invited: 'Davetli', volunteer: 'Gönüllü' };
const ROLE_ROW_LABEL = { regular: 'Normal katılımcı', invited: 'Davetli', volunteer: 'Gönüllü' };
const RSVP_DOT = { coming: 'oklch(0.5 0.08 145)', unsure: 'oklch(0.8 0.13 80)' };
const RSVP_LABEL = { coming: 'Geliyor', unsure: 'Belirsiz' };
const RSVP_INK = { coming: 'oklch(0.3 0.08 150)', unsure: 'oklch(0.46 0.1 62)' };

function initialsOf(name) {
  return (name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

function fmtHHmm(iso) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function normalizeDecimalInput(value) {
  const cleaned = value.replace(/[^0-9.,]/g, '').replace(',', '.');
  const [whole, ...fractions] = cleaned.split('.');
  return fractions.length === 0 ? whole : `${whole}.${fractions.join('').slice(0, 2)}`;
}

// Ulaşım satırının değeri — yalnız gerçekten sakladığımız alanlardan kurulur
// (şoför adı, buluşma yeri/saati). Koltuk numarası yok, uydurulmaz.
function transportInfo(participant, vehicles) {
  if (participant.vehicle_id) {
    const v = vehicles.find((veh) => String(veh.id) === String(participant.vehicle_id));
    if (v) {
      const driver = v.driver_name || v.driver_student_name || 'Şoför';
      const sub = [v.meeting_place, v.meeting_time ? fmtHHmm(v.meeting_time) : null].filter(Boolean).join(', ');
      return { value: `Şoför: ${driver}`, sub: sub || null };
    }
  }
  if (participant.transport_mode === 'self_arranged') return { value: 'Kendi aracıyla geliyor', sub: null };
  if (participant.transport_mode === 'needs_vehicle') return { value: 'Araç bekliyor', sub: 'Henüz atanmadı', tone: 'amber' };
  return { value: 'Belirtilmedi', sub: null };
}

// Kim ödüyor sorusu sonradan da değişir ("kahvaltısını biz karşılayalım",
// "ücretsiz kontenjandan girsin"), o yüzden ekleme ekranındaki seçici burada da
// açılır. Ödemesi alınmış kalem kilitli gelir — backend zaten reddeder.
function FeeSection({ participantId, onChanged }) {
  const [expanded, setExpanded] = React.useState(false);
  const contentId = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const feesQuery = useQuery({
    queryKey: queryKeys.eventParticipantFees(participantId),
    queryFn: () => getEventParticipantFees(participantId),
  });
  const fees = feesQuery.data ?? [];

  async function change(feeItemId, input) {
    setBusy(true);
    setError('');
    try {
      await updateEventParticipantFee(participantId, feeItemId, input);
      await onChanged();
      return true;
    } catch (err) {
      setError(err?.message || 'Ücret güncellenemedi.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (fees.length === 0) return null;

  const items = fees.map((f) => ({
    id: f.fee_item_id,
    label: f.label,
    amount: f.coverage === 'student' ? f.amount_snapshot : f.base_amount_snapshot,
    comp_quota: f.comp_quota,
    comp_used: f.comp_used,
    is_pass_through: f.is_pass_through,
    is_lesson_fee: f.is_lesson_fee,
  }));
  const value = Object.fromEntries(fees.map((f) => [String(f.fee_item_id), f.coverage]));
  const lockedItemIds = new Set(
    fees.filter((f) => Number(f.paid_amount) > 0).map((f) => String(f.fee_item_id)),
  );
  const mineComp = new Set(
    fees.filter((f) => f.coverage === 'comp').map((f) => String(f.fee_item_id)),
  );

  return (
    <div className="evx-section">
      <button type="button" className="evx-fees-toggle" aria-expanded={expanded}
        aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
        <span className="evx-section-label">Ücretler · kimin ödeyeceği</span>
        <Icon.ChevronDown width="18" height="18" aria-hidden="true" />
      </button>
      <div id={contentId} hidden={!expanded}>
        {expanded && <FeeCoverageList
          items={items}
          value={value}
          onChange={change}
          onAmountChange={(id, amount) => change(id, { amount })}
          lockedItemIds={lockedItemIds}
          mineComp={mineComp}
          disabled={busy}
        />}
      </div>
      <FeeCoverageTotals items={items} value={value} />
      {error && <span className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{error}</span>}
    </div>
  );
}

function PaymentHistory({ participantId, onChanged }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = React.useState(null);
  const [error, setError] = React.useState('');
  const paymentsQuery = useQuery({
    queryKey: queryKeys.eventParticipantPayments(participantId),
    queryFn: () => getEventParticipantPayments(participantId),
  });
  const payments = paymentsQuery.data ?? [];

  async function cancelPayment(payment) {
    const note = window.prompt(
      `${fmtTL(payment.amount)} tahsilat gerçek hayatta iade edildiyse iptal nedenini yazın.`,
      'Katılımcı etkinliğe gelmeyecek',
    );
    if (note == null) return;
    setBusyId(payment.id);
    setError('');
    try {
      await cancelEventParticipantPayment(payment.id, note.trim() || null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipantPayments(participantId) });
      await onChanged();
    } catch (err) {
      setError(err?.message || 'Tahsilat iptal edilemedi.');
    } finally {
      setBusyId(null);
    }
  }

  if (paymentsQuery.isLoading || payments.length === 0) return null;
  return (
    <div className="evx-section">
      <span className="evx-section-label">Tahsilat geçmişi</span>
      <div className="evx-group-list">
        {payments.map((payment) => {
          const cancelled = payment.cancelled_at != null;
          const date = new Date(payment.paid_at).toLocaleString('tr-TR', {
            timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          });
          return (
            <div key={payment.id} className="evx-row" style={{ cursor: 'default', opacity: cancelled ? 0.62 : 1 }}>
              <span className="evx-row-body">
                <span className="evx-row-name" style={{ textDecoration: cancelled ? 'line-through' : undefined }}>
                  {fmtTL(payment.amount)} · {payment.source === 'iban' ? 'IBAN' : 'Nakit'}
                </span>
                <span className="evx-row-sub">{cancelled ? `İptal edildi${payment.cancellation_note ? ` · ${payment.cancellation_note}` : ''}` : date}</span>
              </span>
              {!cancelled && (
                <button type="button" className="evx-danger-link" style={{ margin: 0 }}
                  disabled={busyId != null} onClick={() => cancelPayment(payment)}>
                  {busyId === payment.id ? 'İptal…' : 'İade/iptal'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{error}</div>}
    </div>
  );
}

export function MobileEventParticipantDetail({ eventId, participantId, onBack, onRemoved, onOpenParticipant, onOpenTransport, onOpenAddGuest }) {
  const queryClient = useQueryClient();

  const eventQuery = useQuery({ queryKey: queryKeys.eventById(eventId), queryFn: () => getEventById(eventId), enabled: !!eventId });
  const participantsQuery = useQuery({
    queryKey: queryKeys.eventParticipants(eventId),
    queryFn: () => getEventParticipants(eventId),
    enabled: !!eventId,
  });
  const event = eventQuery.data;
  const transportEnabled = !!event?.transport_enabled;
  const vehiclesQuery = useQuery({
    queryKey: queryKeys.eventVehicles(eventId),
    queryFn: () => getEventVehicles(eventId),
    enabled: !!eventId && transportEnabled,
  });
  const participant = (participantsQuery.data ?? []).find((p) => String(p.id) === String(participantId));
  const guests = (participantsQuery.data ?? []).filter((p) => String(p.guest_of_participant_id) === String(participantId));

  const [roleOpen, setRoleOpen] = React.useState(false);
  const [roleBusy, setRoleBusy] = React.useState(false);
  const [roleError, setRoleError] = React.useState('');
  const [rsvpBusy, setRsvpBusy] = React.useState(false);
  const [rsvpError, setRsvpError] = React.useState('');
  const [payOpen, setPayOpen] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [paymentSource, setPaymentSource] = React.useState('cash');
  const paymentKeyRef = React.useRef(null);
  const [payBusy, setPayBusy] = React.useState(false);
  const [payError, setPayError] = React.useState('');
  const [note, setNote] = React.useState('');
  const [noteDirty, setNoteDirty] = React.useState(false);
  const [noteBusy, setNoteBusy] = React.useState(false);
  const [noteError, setNoteError] = React.useState('');
  const [removeBusy, setRemoveBusy] = React.useState(false);
  const [removeError, setRemoveError] = React.useState('');

  const due = Number(participant?.total_due || 0);
  const paid = Number(participant?.total_paid || 0);
  const remaining = Math.max(0, due - paid);

  React.useEffect(() => {
    if (participant && !noteDirty) setNote(participant.note || '');
  }, [participant, noteDirty]);
  React.useEffect(() => {
    setAmount(remaining > 0 ? String(remaining) : '');
  }, [remaining]);

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipantFees(participantId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipantPayments(participantId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.weeklyKpi() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.financeFlow() }),
      ...(participant ? [queryClient.invalidateQueries({ queryKey: queryKeys.studentEventBalances(participant.student_id) })] : []),
    ]);
  }

  async function changeRole(role) {
    if (role === participant.role) return;
    setRoleBusy(true);
    setRoleError('');
    try {
      await updateEventParticipant(participantId, { role });
      await refreshAll();
    } catch (err) {
      setRoleError(err?.message || 'Rol güncellenemedi.');
    } finally {
      setRoleBusy(false);
    }
  }

  async function changeRsvp(status) {
    if (status === participant.rsvp_status) return;
    setRsvpBusy(true);
    setRsvpError('');
    try {
      await updateEventParticipant(participantId, { rsvpStatus: status });
      await refreshAll();
    } catch (err) {
      setRsvpError(err?.message || 'Gelme durumu güncellenemedi.');
    } finally {
      setRsvpBusy(false);
    }
  }

  async function collectPayment() {
    setPayError('');
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return setPayError('Geçerli bir tutar girin.');
    setPayBusy(true);
    try {
      if (!paymentKeyRef.current) {
        paymentKeyRef.current = globalThis.crypto?.randomUUID?.()
          ?? `event-${participantId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      await recordEventParticipantPayment(participantId, {
        amount: normalizeDecimalInput(amount), source: paymentSource, idempotencyKey: paymentKeyRef.current,
      });
      await refreshAll();
      paymentKeyRef.current = null;
      setPayOpen(false);
    } catch (err) {
      setPayError(err?.message || 'Ödeme kaydedilemedi.');
    } finally {
      setPayBusy(false);
    }
  }

  async function saveNote() {
    setNoteBusy(true);
    setNoteError('');
    try {
      await updateEventParticipant(participantId, { note: note.trim() || null });
      setNoteDirty(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) });
    } catch (err) {
      setNoteError(err?.message || 'Not kaydedilemedi.');
    } finally {
      setNoteBusy(false);
    }
  }

  async function handleRemove() {
    const label = participant.student_nickname || participant.student_name;
    const sure = window.confirm(`"${label}" etkinlikten kaldırılacak. Bu işlem geri alınamaz. Emin misiniz?`);
    if (!sure) return;
    setRemoveError('');
    setRemoveBusy(true);
    try {
      await removeEventParticipant(participantId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() });
      onRemoved();
    } catch (err) {
      setRemoveError(err?.message || 'Katılımcı kaldırılamadı.');
      setRemoveBusy(false);
    }
  }

  if (participantsQuery.isLoading) {
    return <div className="evx"><div className="evx-body"><p>Yükleniyor…</p></div></div>;
  }
  if (!participant) {
    return (
      <div className="evx">
        <header className="evx-header">
          <button type="button" className="evx-header-btn" onClick={onBack} title="Geri">
            <Icon.ChevronL width="22" height="22" />
          </button>
          <div className="evx-header-mid"><span className="evx-header-title">Katılımcı</span></div>
        </header>
        <div className="evx-body">
          <p>Katılımcı bulunamadı.</p>
          <button type="button" className="evx-btn-secondary" onClick={onBack}>Geri</button>
        </div>
      </div>
    );
  }

  const displayName = participant.student_nickname || participant.student_name;
  const phone = participant.student_phone;
  const transport = transportEnabled ? transportInfo(participant, vehiclesQuery.data ?? []) : null;

  return (
    <div className="evx">
      <header className="evx-hero">
        <div className="evx-hero-top">
          <button type="button" className="evx-hero-btn" onClick={onBack} title="Geri">
            <Icon.ChevronL width="22" height="22" />
          </button>
          <span className="evx-hero-event">{event?.name}</span>
          <button type="button" className="evx-hero-btn" title="Daha fazla" aria-label="Daha fazla">
            <Icon.More width="20" height="20" style={{ transform: 'rotate(90deg)' }} />
          </button>
        </div>
        <div className="evx-hero-identity">
          <span className="evx-hero-avatar">{initialsOf(participant.student_name)}</span>
          <span className="evx-hero-info">
            <span className="evx-hero-name">{displayName}</span>
            {phone
              ? <a className="evx-hero-phone" href={`tel:${phone}`}>{phone}</a>
              : <span className="evx-hero-phone">Telefon yok</span>}
            <span className="evx-hero-chips">
              <span className="evx-hero-chip is-solid" style={{ color: RSVP_INK[participant.rsvp_status] }}>
                <span className="evx-hero-chip-dot" style={{ background: RSVP_DOT[participant.rsvp_status] }} />
                {RSVP_LABEL[participant.rsvp_status]}
              </span>
              <span className="evx-hero-chip">{ROLE_CHIP_LABEL[participant.role]}</span>
              {guests.length > 0 && <span className="evx-hero-chip">+{guests.length} misafir</span>}
            </span>
          </span>
        </div>
      </header>

      <div className="evx-body">
        <div className="evx-section">
          <span className="evx-section-label">Gelme durumu</span>
          <div className="evx-choice">
            <button
              type="button" disabled={rsvpBusy}
              className={`evx-choice-btn tone-accent${participant.rsvp_status === 'coming' ? ' is-on' : ''}`}
              onClick={() => changeRsvp('coming')}
            >
              <span className="evx-choice-dot" style={{ background: 'oklch(0.5 0.08 145)' }} /> Geliyor
            </button>
            <button
              type="button" disabled={rsvpBusy}
              className={`evx-choice-btn tone-amber${participant.rsvp_status === 'unsure' ? ' is-on' : ''}`}
              onClick={() => changeRsvp('unsure')}
            >
              <span className="evx-choice-dot" style={{ background: 'oklch(0.8 0.13 80)' }} /> Belirsiz
            </button>
          </div>
          {rsvpError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{rsvpError}</div>}
        </div>

        <div className="evx-info-card">
          <button type="button" className="evx-info-row" onClick={() => setRoleOpen((v) => !v)} aria-expanded={roleOpen}>
            <span className="evx-info-icon"><Icon.Instructor width="17" height="17" /></span>
            <span className="evx-info-body">
              <span className="evx-info-label">ROL</span>
              <span className="evx-info-value">{ROLE_ROW_LABEL[participant.role]}</span>
            </span>
            <span className="evx-info-trail">Değiştir</span>
          </button>
          {roleOpen && (
            <div className="evx-info-expand">
              <div className="evx-seg">
                {ROLES.map(([id, label]) => (
                  <button
                    key={id} type="button" disabled={roleBusy}
                    className={`evx-seg-btn${participant.role === id ? ' is-on' : ''}`}
                    onClick={() => changeRole(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="evx-hint">Rol değişince özel tutarlar ve ücret seçimleri o rolün ön ayarına döner. Ödemesi alınmış kalemler korunur.</p>
              {roleError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{roleError}</div>}
            </div>
          )}

          {transportEnabled && (
            <>
              <span className="evx-info-divider" />
              <button type="button" className="evx-info-row" onClick={onOpenTransport}>
                <span className="evx-info-icon"><Icon.Truck width="17" height="17" /></span>
                <span className="evx-info-body">
                  <span className="evx-info-label">ULAŞIM</span>
                  <span className="evx-info-value">{transport.value}</span>
                  {transport.sub && <span className="evx-info-sub">{transport.sub}</span>}
                </span>
                <span className="evx-info-trail">Değiştir</span>
              </button>
            </>
          )}

          {due > 0 && (
            <>
              <span className="evx-info-divider" />
              <div className="evx-info-row" style={{ cursor: 'default' }}>
                <span className="evx-info-icon tone-amber"><Icon.Wallet width="17" height="17" /></span>
                <span className="evx-info-body">
                  <span className="evx-info-label">ÖDEME</span>
                  <span className="evx-info-value">
                    {remaining > 0.001
                      ? <><span style={{ color: 'var(--amber-ink)' }}>{fmtTL(remaining)} kalan</span> · {fmtTL(due)} ücret</>
                      : <span style={{ color: 'var(--accent-ink)' }}>Ödendi · {fmtTL(due)} ücret</span>}
                  </span>
                  <span className="evx-info-sub">{fmtTL(paid)} alındı</span>
                </span>
              </div>
            </>
          )}
        </div>

        <FeeSection participantId={participantId} onChanged={refreshAll} />
        <PaymentHistory participantId={participantId} onChanged={refreshAll} />

        <div className="evx-section">
          <div className="evx-group-head">
            <span className="evx-group-title" style={{ color: 'var(--ink-3)' }}>MİSAFİRLERİ</span>
            <span className="evx-group-count">{guests.length}</span>
            <span className="evx-group-line" />
            {participant.guest_of_participant_id == null && (
              <button type="button" style={{ border: 0, background: 'transparent', font: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', padding: '4px 0' }}
                onClick={() => onOpenAddGuest(participant)}>+ Misafir ekle</button>
            )}
          </div>
          {guests.length === 0 && <p className="evx-hint">Henüz misafiri yok.</p>}
          {guests.length > 0 && (
            <ul className="evx-group-list">
              {guests.map((g) => {
                const gDue = Number(g.total_due || 0);
                const gPaid = Number(g.total_paid || 0);
                const gRemaining = Math.max(0, gDue - gPaid);
                return (
                  <li key={g.id}>
                    <button type="button" className="evx-guest-card" onClick={() => onOpenParticipant(g.id)}>
                      <span className="evx-avatar-wrap">
                        <span className="evx-avatar is-sm">{initialsOf(g.student_name)}</span>
                        <span className="evx-avatar-dot" style={{ background: RSVP_DOT[g.rsvp_status] }} />
                      </span>
                      <span className="evx-row-body">
                        <span className="evx-row-name" style={{ fontSize: 13.5 }}>{g.student_nickname || g.student_name}</span>
                        <span className="evx-row-sub">
                          {RSVP_LABEL[g.rsvp_status]}
                          {gDue > 0 && (
                            gRemaining > 0.001
                              ? <> · <span style={{ color: 'var(--amber-ink)', fontWeight: 600 }}>{fmtTL(gRemaining)} kalan</span></>
                              : <> · {fmtTL(gPaid)} ödendi</>
                          )}
                        </span>
                      </span>
                      <span className="evx-row-chev">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="evx-section">
          <span className="evx-section-label">Bu etkinlik için not</span>
          <div className="evx-field">
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }}
              placeholder="Bu kişinin bu etkinlikteki durumu hakkında not (isteğe bağlı)"
              rows={2}
              maxLength={500}
            />
          </div>
          {noteDirty && (
            <button type="button" className="evx-btn-secondary" disabled={noteBusy} onClick={saveNote}>
              <Icon.Check width="15" height="15" />
              {noteBusy ? 'Kaydediliyor…' : 'Notu kaydet'}
            </button>
          )}
          {noteError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{noteError}</div>}
        </div>

        <button type="button" className="evx-danger-link" disabled={removeBusy} onClick={handleRemove}>
          {removeBusy ? 'Kaldırılıyor…' : 'Etkinlikten çıkar'}
        </button>
        {removeError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)', textAlign: 'center' }} role="alert">{removeError}</div>}
      </div>

      <div className="evx-footer">
        {payOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="evx-seg">
              {[['cash', 'Nakit'], ['iban', 'IBAN']].map(([id, label]) => (
                <button key={id} type="button" className={`evx-seg-btn${paymentSource === id ? ' is-on' : ''}`}
                  disabled={payBusy} onClick={() => { setPaymentSource(id); paymentKeyRef.current = null; }}>{label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={amount} onChange={(e) => { setAmount(normalizeDecimalInput(e.target.value)); paymentKeyRef.current = null; }}
                inputMode="decimal" placeholder="Tutar" autoFocus
                style={{ flex: 1, minHeight: 44, borderRadius: 12, border: '1px solid var(--line)', padding: '0 12px', background: 'var(--surface)', fontSize: 15 }}
              />
              <button type="button" className="evx-btn-primary" style={{ flex: 'none', minHeight: 44, padding: '0 18px' }} disabled={payBusy} onClick={collectPayment}>
                {payBusy ? 'Kaydediliyor…' : 'Onayla'}
              </button>
            </div>
            {payError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{payError}</div>}
            <button type="button" style={{ alignSelf: 'center', border: 0, background: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', minHeight: 0 }}
              onClick={() => { setPayOpen(false); setPayError(''); }}>Vazgeç</button>
          </div>
        ) : (
          <div className="evx-footer-row">
            {phone
              ? <a className="evx-btn-secondary" style={{ flex: 1, justifyContent: 'center' }} href={`tel:${phone}`}><Icon.Phone width="16" height="16" />Ara</a>
              : <button type="button" className="evx-btn-secondary" style={{ flex: 1, justifyContent: 'center' }} disabled><Icon.Phone width="16" height="16" />Ara</button>}
            {due > 0 ? (
              <button type="button" className="evx-btn-primary" style={{ flex: 1.4 }} disabled={remaining <= 0.001} onClick={() => setPayOpen(true)}>
                {remaining > 0.001 ? `${fmtTL(remaining)} ödeme al` : 'Ödendi'}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
