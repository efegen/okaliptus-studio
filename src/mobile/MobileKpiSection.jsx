import React from 'react';
import { fmtTL } from '../data';
import { useWeeklyKpi, parseNumericValue, clampBarWidth } from './shared/useWeeklyKpi';

function getIstanbulToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const y = Number(parts.find(p => p.type === 'year').value);
  const mo = Number(parts.find(p => p.type === 'month').value) - 1;
  const d = Number(parts.find(p => p.type === 'day').value);
  return new Date(y, mo, d, 0, 0, 0, 0);
}

function getCurrentMonthLabel() {
  return getIstanbulToday()
    .toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
    .toLocaleUpperCase('tr-TR');
}

export function MobileKpiSection() {
  const { data, isLoading } = useWeeklyKpi();

  const monthlyCashInflow = parseNumericValue(data?.monthlyCashInflow?.total, 0);
  const monthlyRevenue = parseNumericValue(data?.monthlyRevenue?.total, 0);
  const collectionRate = monthlyRevenue > 0
    ? Math.round((monthlyCashInflow / monthlyRevenue) * 100)
    : 0;
  const collectionBarWidth = clampBarWidth(collectionRate);

  const receivable = parseNumericValue(data?.receivable, 0);
  const debtorCount = parseNumericValue(data?.debtorStudentCount, 0);

  const occupancyRatio = parseNumericValue(data?.occupancyRatio, null);
  const lessonsPlanned = parseNumericValue(data?.lessonCounts?.planned, 0);
  const occupancyPercent = occupancyRatio !== null ? Math.round(occupancyRatio * 100) : 0;
  const occupancyBarWidth = clampBarWidth(occupancyPercent);

  const monthLabel = getCurrentMonthLabel();
  const dim = isLoading ? ' is-loading' : '';

  return (
    <section className="mobile-kpi-section">
      <div className={`mobile-kpi-card${dim}`}>
        <div className="mobile-kpi-label">TAHSİLAT / CİRO · {monthLabel}</div>
        <div className="mobile-kpi-main">
          <span className="mobile-kpi-value-large">
            {isLoading ? '—' : fmtTL(monthlyCashInflow)}
          </span>
          <span className="mobile-kpi-secondary">
            / {isLoading ? '—' : fmtTL(monthlyRevenue)}
          </span>
        </div>
        <div className="mobile-kpi-progress">
          <div
            className="mobile-kpi-progress-fill"
            style={{ width: `${collectionBarWidth}%` }}
          />
        </div>
        <div className="mobile-kpi-context">
          Tahsilat oranı %{collectionRate}
        </div>
      </div>

      <div className="mobile-kpi-row">
        <div className={`mobile-kpi-card warn${dim}`}>
          <div className="mobile-kpi-label">BEKLEYEN TAHSİLAT</div>
          <div className="mobile-kpi-value-medium">
            {isLoading ? '—' : fmtTL(receivable)}
          </div>
          <div className="mobile-kpi-context">
            {isLoading ? '—' : `${debtorCount} öğrenci`}
          </div>
        </div>

        <div className={`mobile-kpi-card${dim}`}>
          <div className="mobile-kpi-label">HAFTALIK DOLULUK</div>
          <div className="mobile-kpi-value-medium">
            {isLoading ? '—' : `%${occupancyPercent}`}
          </div>
          <div className="mobile-kpi-context">
            {isLoading ? '—' : `${lessonsPlanned} ders`}
          </div>
        </div>
      </div>
    </section>
  );
}
