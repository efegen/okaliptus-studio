import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../api';
import { CurrentUserProvider } from '../currentUser';
import { MobileOrders } from '../mobile/MobileOrders';
import { InsightsStrip } from '../mobile/ordersInsights/InsightsStrip';
import {
  approxTL, barSegments, fmtTL, fmtWeekdayDate, rangeLabel,
} from '../mobile/ordersInsights/insightsFormat';

vi.mock('../api', () => ({
  getTrendyolOrdersList: vi.fn(),
  getTrendyolInsights: vi.fn(),
  getCargoChangeStatuses: vi.fn(async () => []),
}));

const TR = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h - 3);

function makeInsights(overrides = {}) {
  return {
    period: 'ay',
    range: { start: TR(2026, 11, 1), end: TR(2026, 11, 13, 12), complete: false },
    generatedAt: TR(2026, 11, 13, 12),
    sales: {
      total: 18449, orders: 42, packages: 43, units: 51, avgOrder: 439.26, deltaPct: 12,
      daily: [
        { date: '2026-11-11', total: 1040, orders: 3 },
        { date: '2026-11-12', total: 2940, orders: 6 },
        { date: '2026-11-13', total: 579, orders: 1 },
      ],
      cancelled: { orders: 2, total: 610 },
      returned: { orders: 1, total: 240 },
    },
    products: {
      count: 7,
      top: [
        { key: 'MAT', barcode: 'MAT', name: 'Yoga Matı 6 mm', imageUrl: null, quantity: 14, total: 9786 },
        { key: 'TUT', barcode: 'TUT', name: "Tütsü Seti (12'li)", imageUrl: null, quantity: 11, total: 1639 },
        { key: 'BLK', barcode: 'BLK', name: 'Yoga Bloğu', imageUrl: null, quantity: 8, total: 2312 },
      ],
    },
    breakdown: {
      sales: 18449, commission: 2398, cargo: 1890, otherFees: 336, stoppage: 154,
      vat: { sales: 3075, deductible: 771, net: 2304 },
      remaining: 11367, remainingPct: 62, avgCommissionRate: 13, cargoPackages: 43, avgCargo: 45,
      settledOrders: 28, estimatedOrders: 14, financeAvailable: true,
    },
    payments: {
      available: true,
      next: { date: TR(2026, 11, 18), amount: 4210, orders: 16 },
      later: { date: TR(2026, 11, 25), amount: 3120, orders: 12 },
      notDelivered: { amount: 4040, orders: 14 },
      past: [{ id: 'PO1', date: TR(2026, 11, 11), amount: 3880, orders: 14, sales: 5364, commission: 697, deductions: 787 }],
    },
    ...overrides,
  };
}

function makeOrder() {
  return {
    id: 'TY1::P1', channel: 'trendyol', orderNumber: 'TY1', packageId: 'P1', status: 'Created', tab: 'yeni',
    orderDate: Date.now() - 3_600_000, agreedDeliveryDate: null, buyerName: 'Ada K.', city: 'İzmir',
    cargoProvider: null, saleAmount: 100, discount: 0, billable: 100, invoiced: false,
    lines: [{ lineId: '1', quantity: 1, productName: 'Mat', barcode: 'B1' }],
  };
}

function renderOrders(role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrentUserProvider user={{ id: 1, username: 'u', role }}>
        <MobileOrders onBack={() => {}} onOpenDetail={() => {}} />
      </CurrentUserProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTrendyolOrdersList.mockResolvedValue({ orders: [makeOrder()], tabCounts: { tum: 1, yeni: 1 }, total: 1 });
  api.getTrendyolInsights.mockResolvedValue(makeInsights());
});

describe('insightsFormat', () => {
  it('tutarları kuruşsuz Türkçe biçimler, tahmini olanı ≈ ile işaretler', () => {
    expect(fmtTL(18449.4)).toBe('₺18.449');
    expect(fmtTL(-120)).toBe('−₺120');
    expect(fmtTL(null)).toBe('—');
    expect(approxTL(11367, true)).toBe('≈ ₺11.367');
    expect(approxTL(11367, false)).toBe('₺11.367');
  });

  it('dönem etiketleri ve tarih İstanbul saatine göre', () => {
    const range = { start: TR(2026, 11, 1), end: TR(2026, 11, 13, 12) };
    expect(rangeLabel('ay', range)).toBe('1–13 Kasım');
    expect(rangeLabel('gecen', { start: TR(2026, 10, 1), end: TR(2026, 11, 1) })).toBe('Ekim');
    expect(rangeLabel('hafta', { start: TR(2026, 10, 26), end: TR(2026, 11, 1, 9) })).toBe('26 Eki – 1 Kas');
    expect(fmtWeekdayDate(TR(2026, 11, 18))).toBe('Çarşamba, 18 Kasım');
  });

  it('çubuk parçaları kesintiler + kalan = %100', () => {
    const segs = barSegments(makeInsights().breakdown);
    const total = segs.reduce((s, x) => s + x.pct, 0);
    expect(Math.round(total)).toBe(100);
    expect(segs[segs.length - 1].key).toBe('kalan');
  });
});

describe('InsightsStrip', () => {
  it('kartları gösterir, karta ve döneme dokunmak ilgili işlevi çağırır', () => {
    const onOpen = vi.fn();
    const onPeriodChange = vi.fn();
    render(
      <InsightsStrip period="ay" onPeriodChange={onPeriodChange} data={makeInsights()} onOpen={onOpen} onRetry={() => {}} />,
    );
    expect(screen.getByText('≈ ₺11.367')).toBeTruthy();
    expect(screen.getByText('₺18.449 satıştan')).toBeTruthy();
    expect(screen.getByText('14 adet ile ilk sırada')).toBeTruthy();
    expect(screen.getByText('+4 ürün')).toBeTruthy();
    expect(screen.getByText('ort. ₺439')).toBeTruthy();
    expect(screen.getByText('Çarşamba, 18 Kasım')).toBeTruthy();

    fireEvent.click(screen.getByText('Sana kalan').closest('button'));
    expect(onOpen).toHaveBeenCalledWith('kalan');
    fireEvent.click(screen.getByText('En çok satanlar').closest('button'));
    expect(onOpen).toHaveBeenCalledWith('cok');
    fireEvent.click(screen.getByRole('button', { name: 'Bu hafta' }));
    expect(onPeriodChange).toHaveBeenCalledWith('hafta');
  });

  it('ekstre kesinleşmişse ≈ işareti yok', () => {
    const data = makeInsights();
    data.breakdown.estimatedOrders = 0;
    render(<InsightsStrip period="ay" onPeriodChange={() => {}} data={data} onOpen={() => {}} onRetry={() => {}} />);
    expect(screen.getByText('₺11.367')).toBeTruthy();
  });
});

describe('MobileOrders — Trendyol özeti', () => {
  it('yönetici özeti görür; sekmeler özetin altında; detay açılıp kapanır', async () => {
    renderOrders('owner');
    await screen.findByText('≈ ₺11.367');
    expect(api.getTrendyolInsights).toHaveBeenCalledWith('ay');

    // Sekmeler özet şeridinden SONRA gelir (listeye bitişik).
    const strip = screen.getByLabelText('Trendyol özeti');
    const tabs = screen.getByRole('tablist', { name: 'Sipariş durumu' });
    expect(strip.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(strip).getByText('Sana kalan').closest('button'));
    const page = await screen.findByRole('dialog', { name: 'Sana kalan' });
    expect(within(page).getByText('Nereye gitti?')).toBeTruthy();
    expect(within(page).getByText('14 sipariş henüz teslim edilmedi.')).toBeTruthy();
    fireEvent.click(within(page).getByText('KDV').closest('button'));
    expect(within(page).getByText(/Trendyol bunu kesmez/)).toBeTruthy();

    fireEvent.click(within(page).getByRole('button', { name: 'Siparişlere dön' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('dönem değişince o dönemin özeti istenir', async () => {
    renderOrders('admin');
    await screen.findByText('≈ ₺11.367');
    fireEvent.click(screen.getByRole('button', { name: 'Geçen ay' }));
    await waitFor(() => expect(api.getTrendyolInsights).toHaveBeenCalledWith('gecen'));
  });

  it('asistan özeti görmez ve finans ucu çağrılmaz', async () => {
    renderOrders('assistant');
    await screen.findByText('Ada K.');
    expect(screen.queryByLabelText('Trendyol özeti')).toBeNull();
    expect(api.getTrendyolInsights).not.toHaveBeenCalled();
  });
});
