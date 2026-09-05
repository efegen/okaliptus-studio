import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MobileHomeView } from '../mobile/home/MobileHomeView';

const baseProps = {
  dateLabel: 'Cuma, 5 Eylül 2026',
  headline: 'Bugün 2 ders var',
  user: { displayName: 'Efe' },
  onOpenFinance: () => {},
  onOpenOccupancy: () => {},
  onOpenOrders: () => {},
  onOpenNotes: () => {},
  onOpenEvent: () => {},
  canSeeFinance: true,
  canSeeOrders: true,
};

function heroSlideOrder() {
  const slides = document.querySelectorAll('.mh-hero-slide');
  return Array.from(slides).map(slide => {
    if (slide.querySelector('.mh-event-card, .mh-event-empty')) return 'event';
    if (slide.querySelector('.mh-hero')) return 'finance';
    return 'unknown';
  });
}

describe('Mobil ana sayfa hero sırası', () => {
  it('yaklaşan etkinlik varken etkinlik kartını 1. sıraya koyar', () => {
    render(
      <MobileHomeView
        {...baseProps}
        event={{
          id: 'e1',
          name: 'Kum Saati Retreat',
          starts_at: '2026-09-10T10:00:00.000Z',
          coming: 3,
          unsure: 1,
          totalParticipants: 5,
          registeredCount: 4,
          guestCount: 0,
          potentialAmount: 1000,
        }}
      />,
    );
    expect(heroSlideOrder()).toEqual(['event', 'finance']);
  });

  it('yaklaşan etkinlik yokken (event=null) tahsilat kartını 1. sıraya koyar', () => {
    render(<MobileHomeView {...baseProps} event={null} />);
    expect(heroSlideOrder()).toEqual(['finance', 'event']);
    expect(screen.getByText('Son 30 günde tahsil edilen')).toBeInTheDocument();
  });
});
