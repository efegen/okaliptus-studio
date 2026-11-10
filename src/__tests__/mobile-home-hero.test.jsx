import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MobileHomeView } from '../mobile/home/MobileHomeView';
import { earnedPaidRate } from '../earnedPaid';

// Ana sayfa hero'su: büyük sayı son 30 günün kasa girişi, alt satır son 30
// günün hak edişinin ödenen yüzdesi (aynı kalemler → 0–100 arası).
function renderHero(props) {
  return render(
    <MobileHomeView
      dateLabel="10 Kasım"
      headline="Bugün ders yok"
      user={{ displayName: 'Efe' }}
      canSeeOrders={false}
      {...props}
    />,
  );
}

describe('earnedPaidRate', () => {
  it('hak edişin ödenen yüzdesini verir', () => {
    expect(earnedPaidRate(10000, 1500)).toBe(85);
    expect(earnedPaidRate(10000, 0)).toBe(100);
    expect(earnedPaidRate(10000, 10000)).toBe(0);
  });

  it('hak ediş yoksa 0 döner', () => {
    expect(earnedPaidRate(0, 0)).toBe(0);
  });

  it('bekleyen varken %100, ödenen varken %0 göstermez', () => {
    expect(earnedPaidRate(10000, 20)).toBe(99);
    expect(earnedPaidRate(10000, 9980)).toBe(1);
  });
});

describe('Ana sayfa tahsilat hero alt satırı', () => {
  it('hak edişin yüzde kaçının ödendiğini gösterir; kasa girişi büyük sayıda kalır', () => {
    renderHero({ collected: 42000, revenue: 38000, outstanding: 5700 });
    expect(screen.getByText('Son 30 günde tahsil edilen')).toBeInTheDocument();
    expect(screen.getByText(/42\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Son 30 günün hak edişi 38\.000.*%85'i ödendi/)).toBeInTheDocument();
  });

  it('kasa girişi hak edişi aşsa bile oran %100\'ü geçmez', () => {
    // Paket satışı / eski borç ödemesi kasa girişini şişirir; oranı etkilemez.
    renderHero({ collected: 90000, revenue: 10000, outstanding: 4000 });
    expect(screen.getByText(/%60'ı ödendi/)).toBeInTheDocument();
  });

  it('bekleyen yoksa "tamamı ödendi" yazar', () => {
    renderHero({ collected: 12000, revenue: 9000, outstanding: 0 });
    expect(screen.getByText(/hak edişi 9\.000.*tamamı ödendi/)).toBeInTheDocument();
  });

  it('hak ediş yoksa bunu söyler', () => {
    renderHero({ collected: 3000, revenue: 0, outstanding: 0 });
    expect(screen.getByText('Son 30 günde hak ediş yok')).toBeInTheDocument();
  });
});
