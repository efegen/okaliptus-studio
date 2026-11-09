import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  NAV_TAP_GUARD_MS,
  WeekNavBar,
  occupancyPct,
  summarizeWeek,
} from '../mobile/MobileCalendarWeekNav';

const lessons = (status, n) => Array.from({ length: n }, () => ({ status }));

const WEEK = new Date(2026, 10, 9);   // Pzt 9 Kas 2026
const PREV = new Date(2026, 10, 2);
const NEXT = new Date(2026, 10, 16);

let byWeek = {};

vi.mock('../api', () => ({
  getWeekLessons: vi.fn(async (weekStart) => byWeek[weekStart.getTime()] ?? []),
  getSettings: vi.fn(async () => ({ weeklyCapacity: 25 })),
}));

function Harness() {
  const [ws, setWs] = React.useState(WEEK);
  const shift = (days) => () =>
    setWs((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
  return <WeekNavBar weekStart={ws} onPrev={shift(-7)} onNext={shift(7)} onToday={() => setWs(WEEK)} />;
}

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const summaryButton = () => screen.getByRole('button', { name: /Haftanın özeti/ });
const panel = () => screen.queryByRole('region', { name: 'Haftanın doluluk özeti' });

describe('summarizeWeek / occupancyPct', () => {
  it('counts like the weekly KPI: scheduled + completed + no_show, cancelled excluded', () => {
    const s = summarizeWeek([
      ...lessons('completed', 4),
      ...lessons('scheduled', 3),
      ...lessons('no_show', 1),
      ...lessons('cancelled', 2),
    ]);
    expect(s).toEqual({ completed: 4, scheduled: 3, noShow: 1, cancelled: 2, total: 8 });
  });

  it('rounds the percentage and returns null without a capacity', () => {
    expect(occupancyPct(18, 25)).toBe(72);
    expect(occupancyPct(1, 3)).toBe(33);
    expect(occupancyPct(5, null)).toBeNull();
    expect(occupancyPct(5, 0)).toBeNull();
  });
});

describe('WeekNavBar weekly occupancy', () => {
  it('shows the lesson count and occupancy in the bar', async () => {
    byWeek = {
      [WEEK.getTime()]: [...lessons('completed', 9), ...lessons('scheduled', 9), ...lessons('cancelled', 1)],
      [PREV.getTime()]: lessons('completed', 16),
    };
    renderBar();
    await waitFor(() => expect(screen.getByText('18 ders')).toBeInTheDocument());
    expect(screen.getByText('%72 dolu')).toBeInTheDocument();
    expect(panel()).toBeNull();
  });

  it('opens the summary with app status names, no day row and no empty-slot info', async () => {
    byWeek = {
      [WEEK.getTime()]: [...lessons('completed', 9), ...lessons('scheduled', 9), ...lessons('cancelled', 1)],
      [PREV.getTime()]: lessons('completed', 16),
    };
    renderBar();
    await waitFor(() => expect(screen.getByText('18 ders')).toBeInTheDocument());
    await waitFor(() => expect(summaryButton()).toBeEnabled());

    fireEvent.click(summaryButton());
    const p = panel();
    expect(p).not.toBeNull();
    expect(summaryButton()).toHaveAttribute('aria-expanded', 'true');

    const tile = (label) => within(p).getByText(label).closest('.mobile-cal-occ-tile');
    expect(tile('Tamamlandı')).toHaveTextContent('Tamamlandı9');
    expect(tile('Planlı')).toHaveTextContent('Planlı9');
    expect(tile('İptal')).toHaveTextContent('İptal1');
    expect(within(p).queryByText('Gelmedi')).toBeNull();
    expect(within(p).getByText('%72')).toBeInTheDocument();
    expect(within(p).getByText('18 / 25 ders')).toBeInTheDocument();
    await waitFor(() => expect(within(p).getByText('+8 puan')).toBeInTheDocument());
    expect(within(p).getByText(/hafta %64/)).toBeInTheDocument();

    expect(p).not.toHaveTextContent(/boş/i);
    expect(p).not.toHaveTextContent(/Doluluk ekranı/);
    expect(p).not.toHaveTextContent(/Pzt|Sal|Çar|Per|Cum|Cmt|Paz/);

    fireEvent.click(screen.getByRole('button', { name: 'Özeti kapat' }));
    expect(panel()).toBeNull();
  });

  it('adds a Gelmedi tile when the week has a no-show, counted in the total', async () => {
    byWeek = {
      [WEEK.getTime()]: [
        ...lessons('completed', 8), ...lessons('scheduled', 9),
        ...lessons('no_show', 1), ...lessons('cancelled', 1),
      ],
      [PREV.getTime()]: [],
    };
    renderBar();
    await waitFor(() => expect(screen.getByText('18 ders')).toBeInTheDocument());
    fireEvent.click(summaryButton());
    const p = panel();
    expect(within(p).getByText('Gelmedi').closest('.mobile-cal-occ-tile')).toHaveTextContent('Gelmedi1');
    expect(p.querySelector('.mobile-cal-occ-tiles')).toHaveClass('is-four');
  });

  it('ignores a summary tap right after switching weeks', async () => {
    byWeek = {
      [WEEK.getTime()]: lessons('scheduled', 5),
      [PREV.getTime()]: [],
      [NEXT.getTime()]: lessons('scheduled', 10),
    };
    renderBar();
    await waitFor(() => expect(screen.getByText('5 ders')).toBeInTheDocument());

    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    fireEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }));
    fireEvent.click(summaryButton());
    expect(panel()).toBeNull();

    now += NAV_TAP_GUARD_MS - 100;
    fireEvent.click(summaryButton());
    expect(panel()).toBeNull();

    now += 200;
    fireEvent.click(summaryButton());
    expect(panel()).not.toBeNull();
  });

  it('keeps the panel open while switching weeks and shows the new week', async () => {
    byWeek = {
      [WEEK.getTime()]: lessons('scheduled', 5),
      [PREV.getTime()]: [],
      [NEXT.getTime()]: lessons('scheduled', 10),
    };
    renderBar();
    await waitFor(() => expect(screen.getByText('5 ders')).toBeInTheDocument());
    fireEvent.click(summaryButton());
    expect(panel()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }));
    await waitFor(() => expect(screen.getByText('10 ders')).toBeInTheDocument());
    expect(panel()).not.toBeNull();
    expect(within(panel()).getByText('10 / 25 ders')).toBeInTheDocument();
  });
});
