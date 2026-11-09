import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  OffscreenLessonChips,
  hiddenSplit,
  plannedSpans,
} from '../mobile/MobileCalendarOffscreenChips';

// Takvimdeki normalize edilmiş ders (useWeekLessons) biçimi — yalnız kullanılan alanlar.
function lesson(time, lessonState, durationMinutes = 60) {
  const [hour, minute] = time.split(':').map(Number);
  return { time, hour, minute, durationMinutes, lessonState };
}

const week = (byDay) => Array.from({ length: 7 }, (_, d) => byDay[d] || []);

// Telefon: kaydırma alanı 643 px (36 px gün başlığı + 607 px gövde); 768 px
// içerikte en alta kaydırılmış hali scrollTop 161 (08:00–11:21 yukarıda).
function renderChips(sessionsByDay, { scrollTop = 161, clientHeight = 643 } = {}) {
  function Harness() {
    const scrollRef = React.useRef(null);
    const bodiesRef = React.useRef(null);
    const setScroll = React.useCallback((el) => {
      scrollRef.current = el;
      if (!el || el.scrollTo?.mock) return;
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
      Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
      el.scrollTo = vi.fn();
    }, []);
    return (
      <>
        <div data-testid="scroll" ref={setScroll}>
          <div data-testid="bodies" ref={bodiesRef} />
        </div>
        <OffscreenLessonChips scrollRef={scrollRef} bodiesRef={bodiesRef} sessionsByDay={sessionsByDay} />
      </>
    );
  }
  return render(<Harness />);
}

describe('plannedSpans / hiddenSplit', () => {
  it('keeps only planned lessons, sorted, in grid pixels', () => {
    const spans = plannedSpans([
      lesson('10:30', 'planned'),
      lesson('09:00', 'paid'),
      lesson('09:30', 'planned', 90),
      lesson('07:30', 'planned'),
      lesson('11:00', 'unpaid'),
      lesson('12:00', 'partial'),
    ]);
    expect(spans.map((s) => [s.time, s.top, s.bottom])).toEqual([
      ['09:30', 72, 144],
      ['10:30', 120, 168],
    ]);
  });

  it('counts a lesson as hidden only when less than 12px of it shows', () => {
    const spans = plannedSpans([lesson('10:30', 'planned'), lesson('11:00', 'planned'), lesson('22:00', 'planned')]);
    const { above, below } = hiddenSplit(spans, 161, 161 + 607);
    expect(above.map((s) => s.time)).toEqual(['10:30']);
    expect(below).toEqual([]);
    expect(hiddenSplit(spans, 0, 607).below.map((s) => s.time)).toEqual(['22:00']);
  });
});

describe('OffscreenLessonChips', () => {
  it('shows an up chip only on days with hidden planned lessons', () => {
    renderChips(week({
      1: [lesson('09:30', 'planned'), lesson('09:00', 'paid'), lesson('18:00', 'planned')],
      2: [lesson('08:00', 'unpaid'), lesson('10:00', 'partial')],
      3: [lesson('10:30', 'planned'), lesson('11:00', 'planned')],
    }));
    const chips = screen.getAllByRole('button');
    expect(chips.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Salı: yukarıda 1 planlı ders, ilkine git',
      'Perşembe: yukarıda 1 planlı ders, ilkine git',
    ]);
    expect(chips[0]).toHaveTextContent('1 ders');
  });

  it('scrolls to the first hidden planned lesson of that day', () => {
    renderChips(week({ 1: [lesson('10:00', 'planned'), lesson('09:30', 'planned')] }));
    expect(screen.getByRole('button')).toHaveTextContent('2 ders');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('scroll').scrollTo).toHaveBeenCalledWith({ top: 64, behavior: 'smooth' });
  });

  it('shows a down chip when scrolled up and scrolls to it', () => {
    renderChips(week({ 4: [lesson('22:00', 'planned')] }), { scrollTop: 0 });
    const chip = screen.getByRole('button', { name: 'Cuma: aşağıda 1 planlı ders, ilkine git' });
    fireEvent.click(chip);
    expect(screen.getByTestId('scroll').scrollTo).toHaveBeenCalledWith({ top: 121, behavior: 'smooth' });
  });

  it('updates when the calendar is scrolled', () => {
    renderChips(week({ 1: [lesson('09:30', 'planned')] }));
    expect(screen.getByRole('button')).toBeInTheDocument();
    const scroll = screen.getByTestId('scroll');
    scroll.scrollTop = 0;
    act(() => { fireEvent.scroll(scroll); });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('mirrors the calendar bodies horizontal transform', async () => {
    const { container } = renderChips(week({}));
    const track = container.querySelector('.mobile-cal-offscreen-track');
    const bodies = screen.getByTestId('bodies');
    bodies.style.transition = 'none';
    bodies.style.transform = 'translateX(-111px)';
    await waitFor(() => expect(track.style.transform).toBe('translateX(-111px)'));
    expect(track.style.transition).toBe('none');
  });
});
