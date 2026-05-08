import React from 'react';
import { fmtTL } from '../../data';
import { useWeeklyKpi, parseNumericValue, clampBarWidth } from '../shared/useWeeklyKpi';

function getCurrentMonthLabel() {
  const formatter = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    month: 'long',
    year: 'numeric',
  });
  return formatter.format(new Date()).toLocaleUpperCase('tr-TR');
}

export function MobileFinanceSummary() {
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

  const monthLabel = getCurrentMonthLabel();
  const dim = isLoading ? ' is-loading' : '';

  return (
    <section className="mobile-finance" aria-label="Finansal özet">
      <div className={`mobile-finance-card${dim}`}>
        <div className="mobile-finance-label">TAHSİLAT / CİRO · {monthLabel}</div>
        <div className="mobile-finance-hero">
          <span className="mobile-finance-hero-value">
            {isLoading ? '—' : fmtTL(monthlyCashInflow)}
          </span>
          <span className="mobile-finance-hero-divider">
            / {isLoading ? '—' : fmtTL(monthlyRevenue)}
          </span>
        </div>
        <div className="mobile-finance-progress" aria-hidden>
          <div
            className="mobile-finance-progress-fill"
            style={{ width: `${collectionBarWidth}%` }}
          />
        </div>
        <p className="mobile-finance-context">
          Tahsilat oranı %{collectionRate}
        </p>

        <div className="mobile-finance-divider-line" aria-hidden />

        <div className="mobile-finance-secondary">
          <div className="mobile-finance-metric warn">
            <div className="mobile-finance-metric-head">
              <span className="mobile-finance-metric-dot warn" aria-hidden />
              Bekleyen
            </div>
            <div className="mobile-finance-metric-value">
              {isLoading ? '—' : fmtTL(receivable)}
            </div>
            <div className="mobile-finance-metric-sub">
              {isLoading ? '—' : `${debtorCount} öğrenci`}
            </div>
          </div>
          <div className="mobile-finance-metric">
            <div className="mobile-finance-metric-head">
              <span className="mobile-finance-metric-dot" aria-hidden />
              Doluluk
            </div>
            <div className="mobile-finance-metric-value">
              {isLoading ? '—' : `%${occupancyPercent}`}
            </div>
            <div className="mobile-finance-metric-sub">
              {isLoading ? '—' : `${lessonsPlanned} ders`}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
