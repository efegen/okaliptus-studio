import React from 'react';
import { Drawer } from 'vaul';
import { fmtTL } from '../data';
import {
  LESSON_STATE_META,
  PAYMENT_METHOD_LABELS,
  getLessonStateInfo,
} from './shared/lessonMeta';

function extractIstanbulParts(isoString) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(isoString));
  const get = type => Number(parts.find(p => p.type === type).value);
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

function formatHeaderDate(startsAt) {
  if (!startsAt) return '';
  const { year, month, day } = extractIstanbulParts(startsAt);
  const local = new Date(year, month, day);
  return local.toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatModeLabel(mode) {
  return mode === 'online' ? 'Online' : 'Yüzyüze';
}

function debtStateFor(paid, total) {
  if (total <= 0) return 'empty';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function MobileDebtCard({ label, paid, total, paymentMethod, state }) {
  const remaining = total - paid;

  return (
    <div className={`mobile-lsheet-debt-card is-${state}`}>
      <div className="mobile-lsheet-debt-headline">
        <span className="mobile-lsheet-debt-label">{label}</span>
        {state !== 'empty' && total > 0 && (
          <span className="mobile-lsheet-debt-total">{fmtTL(total)}</span>
        )}
      </div>

      {state === 'empty' && (
        <div className="mobile-lsheet-debt-amt-sub">Tutar tanımlı değil</div>
      )}

      {state === 'paid' && (
        <div className="mobile-lsheet-debt-cleared">
          <span className="mobile-lsheet-debt-tick" aria-hidden="true">✓</span>
          <span>Tahsil edildi{paymentMethod ? ` · ${paymentMethod}` : ''}</span>
        </div>
      )}

      {(state === 'partial' || state === 'unpaid') && (
        <>
          <div className="mobile-lsheet-debt-amt-big">{fmtTL(remaining)} kalan</div>
          <div className="mobile-lsheet-debt-amt-sub">
            {fmtTL(paid)} / {fmtTL(total)} ödendi
            {paymentMethod ? ` · ${paymentMethod}` : ''}
          </div>
        </>
      )}
    </div>
  );
}

function NoteBlock({ text }) {
  return (
    <div className="mobile-lsheet-note">
      <span className="mobile-lsheet-note-label">Not</span>
      <span className="mobile-lsheet-note-text">{text}</span>
    </div>
  );
}

export function MobileLessonSheet({ session, onClose }) {
  const open = !!session;
  const stateMeta = session ? LESSON_STATE_META[session.lessonState] : null;
  const stateInfo = session ? getLessonStateInfo(session) : null;
  const productSales = session?.productSales ?? [];
  const productsRemaining = productSales.reduce((a, s) => a + (s.remaining || 0), 0);
  const lessonRemaining = session ? Math.max(0, session.price - session.paid) : 0;
  const totalRemaining = lessonRemaining + productsRemaining;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      dismissible
      shouldScaleBackground={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="mobile-lsheet-overlay" />
        <Drawer.Content className="mobile-lsheet-content">
          <Drawer.Handle className="mobile-lsheet-handle" />
          {session && (
            <>
              <header className="mobile-lsheet-header">
                <span className={`mobile-lsheet-pill ${stateMeta?.cls ?? ''}`}>
                  {stateInfo.label}
                </span>
                <Drawer.Title className="mobile-lsheet-name">
                  {session.studentName}
                  {session.studentNickname && (
                    <span className="mobile-lsheet-nick"> ({session.studentNickname})</span>
                  )}
                </Drawer.Title>
                <div className="mobile-lsheet-meta">
                  {formatHeaderDate(session.startsAt)} · {session.time} · {formatModeLabel(session.mode)}
                </div>
              </header>

              <div className="mobile-lsheet-body">
                {session.lessonState === 'planned' && (
                  <>
                    <div className="mobile-lsheet-summary-row">
                      <span>Ders ücreti</span>
                      <span>{session.price > 0 ? fmtTL(session.price) : '—'}</span>
                    </div>
                    {session.note && <NoteBlock text={session.note} />}
                  </>
                )}

                {session.lessonState !== 'planned' && session.lessonState !== 'cancelled' && (
                  <>
                    <MobileDebtCard
                      label="Ders ücreti"
                      total={session.price}
                      paid={session.paid}
                      paymentMethod={session.paymentMethod
                        ? (PAYMENT_METHOD_LABELS[session.paymentMethod] || session.paymentMethod)
                        : null}
                      state={session.lessonState}
                    />

                    {productSales.map(sale => (
                      <MobileDebtCard
                        key={sale.id}
                        label={(sale.note && sale.note.trim()) || 'Ürün satışı'}
                        total={sale.totalAmount}
                        paid={sale.paidAmount}
                        paymentMethod={null}
                        state={debtStateFor(sale.paidAmount, sale.totalAmount)}
                      />
                    ))}

                    {productSales.length > 0 && totalRemaining > 0 && (
                      <div className="mobile-lsheet-totalremaining">
                        <span>Toplam kalan</span>
                        <span>{fmtTL(totalRemaining)}</span>
                      </div>
                    )}

                    {productSales.length > 0 && totalRemaining === 0 && (
                      <div className="mobile-lsheet-cleared">
                        <span aria-hidden="true">✓</span>
                        <span>Tüm tahsilatlar tamamlandı</span>
                      </div>
                    )}

                    {session.note && <NoteBlock text={session.note} />}
                  </>
                )}
              </div>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
