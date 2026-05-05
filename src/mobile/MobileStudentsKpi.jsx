import React from 'react';
import { fmtTL, parseMoney } from './shared/studentMeta';

function fmtNum(v) {
  return v === null || v === undefined ? '—' : String(v);
}

function KpiCard({ filterId, activeFilter, onToggleFilter, extraClass = '', children }) {
  const isSelected = filterId && activeFilter === filterId;
  const interactive = Boolean(filterId);
  const className =
    'mobile-kpi-card' +
    (extraClass ? ' ' + extraClass : '') +
    (interactive ? ' is-tappable' : '') +
    (isSelected ? ' is-selected' : '');

  if (!interactive) {
    return <div className={className}>{children}</div>;
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => onToggleFilter(filterId)}
      aria-pressed={isSelected}
    >
      {children}
    </button>
  );
}

export function MobileStudentsKpi({ kpi, isLoading, activeFilter, onToggleFilter }) {
  const activeCount = kpi?.activeCount ?? null;
  const newThisMonth = kpi?.newThisMonth ?? null;
  const debtorCount = kpi?.debtorCount ?? null;
  const totalDebt = kpi ? parseMoney(kpi.totalDebt) : 0;
  const inactive14 = kpi?.inactiveOver14Days ?? null;
  const monthlyCompleted = kpi?.monthlyCompletedLessons ?? null;
  const prevMonthlyCompleted = kpi?.previousMonthCompletedLessons ?? null;

  const monthlyDelta =
    monthlyCompleted !== null && prevMonthlyCompleted !== null
      ? monthlyCompleted - prevMonthlyCompleted
      : null;
  const monthlyDeltaTone =
    monthlyDelta === null ? 'flat'
      : monthlyDelta > 0 ? 'up'
      : monthlyDelta < 0 ? 'down'
      : 'flat';

  const debtorWarn = (debtorCount ?? 0) > 0;
  const dim = isLoading ? 'is-loading' : '';

  return (
    <section className="mobile-students-kpi">
      <div className="mobile-students-kpi-strip">
        <KpiCard
          filterId="active"
          activeFilter={activeFilter}
          onToggleFilter={onToggleFilter}
          extraClass={dim}
        >
          <div className="mobile-kpi-label">AKTİF ÖĞRENCİ</div>
          <div className="mobile-kpi-value-medium">{fmtNum(activeCount)}</div>
          <div className="mobile-kpi-context">
            {newThisMonth !== null
              ? <><strong>{newThisMonth}</strong> bu ay yeni</>
              : '—'}
          </div>
        </KpiCard>

        <KpiCard
          filterId="debtor"
          activeFilter={activeFilter}
          onToggleFilter={onToggleFilter}
          extraClass={[debtorWarn ? 'warn' : '', dim].filter(Boolean).join(' ')}
        >
          <div className="mobile-kpi-label">BORÇLU ÖĞRENCİ</div>
          <div className="mobile-kpi-value-medium">{fmtNum(debtorCount)}</div>
          <div className="mobile-kpi-context">
            {kpi ? <>Toplam <strong>{fmtTL(totalDebt)}</strong></> : '—'}
          </div>
        </KpiCard>

        <KpiCard
          filterId="inactive14"
          activeFilter={activeFilter}
          onToggleFilter={onToggleFilter}
          extraClass={dim}
        >
          <div className="mobile-kpi-label">14+ GÜNDÜR YOK</div>
          <div className="mobile-kpi-value-medium">{fmtNum(inactive14)}</div>
          <div className="mobile-kpi-context">
            {inactive14 !== null ? 'Aktifler arasında' : '—'}
          </div>
        </KpiCard>

        <KpiCard extraClass={dim}>
          <div className="mobile-kpi-label">BU AY DERS</div>
          <div className="mobile-kpi-value-medium">{fmtNum(monthlyCompleted)}</div>
          <div className="mobile-kpi-context">
            {monthlyDelta === null ? '—' : (
              <span className={`mobile-students-kpi-delta tone-${monthlyDeltaTone}`}>
                Geçen ay {prevMonthlyCompleted}
                {' · '}
                {monthlyDelta > 0 ? `+${monthlyDelta}` : monthlyDelta}
              </span>
            )}
          </div>
        </KpiCard>
      </div>
    </section>
  );
}
