import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../api';
import { CurrentUserProvider } from '../currentUser';
import { MobileOrders } from '../mobile/MobileOrders';
import { InsightsStrip } from '../mobile/ordersInsights/InsightsStrip';
import {
  approxTL, barSegments, fmtTL, fmtWeekdayDate, rangeLabel, scopeInsights, scopeLabel,
} from '../mobile/ordersInsights/insightsFormat';

vi.mock('../api', () => ({
  getTrendyolOrdersList: vi.fn(),
  getHepsiburadaOrdersList: vi.fn(async () => ({ orders: [], tabCounts: {}, total: 0, configured: false })),
  getMarketplaceInsights: vi.fn(),
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
      next: { date: TR(2026, 11, 18), amount: 4210, orders: 16, channel: 'trendyol' },
      later: { date: TR(2026, 11, 25), amount: 3120, orders: 12, channel: 'trendyol' },
      notDelivered: { amount: 4040, orders: 14 },
      past: [{ id: 'PO1', date: TR(2026, 11, 11), amount: 3880, orders: 14, sales: 5364, commission: 697, deductions: 787, channel: 'trendyol' }],
    },
    ...overrides,
  };
}

// GET /channels/insights yanıtı: yalnız Trendyol bağlı.
function makeResponse(overrides = {}) {
  const ty = makeInsights();
  return { ...ty, channels: ['trendyol'], failed: [], byChannel: { trendyol: ty }, ...overrides };
}

// İki kanal: Trendyol + Hepsiburada (HB'nin ödemesi daha erken, salı).
function makeCombined() {
  const ty = makeInsights();
  const hb = makeInsights({
    sales: { ...ty.sales, total: 3629, orders: 11, avgOrder: 329.91, deltaPct: 73 },
    breakdown: {
      ...ty.breakdown, sales: 3629, commission: 958, cargo: 1237, otherFees: 175, stoppage: 30,
      vat: { sales: 605, deductible: 395, net: 210 }, remaining: 1019, remainingPct: 28,
      avgCommissionRate: 22, commissionVatAdded: true, settledOrders: 6, estimatedOrders: 5,
    },
    payments: {
      available: true,
      next: { date: TR(2026, 11, 17), amount: 125, orders: 1, channel: 'hepsiburada' },
      later: { date: TR(2026, 11, 24), amount: 2399, orders: 15, channel: 'hepsiburada' },
      notDelivered: { amount: 229, orders: 2 },
      past: [{ id: 'HB1', date: TR(2026, 11, 10), amount: 250, orders: 2, sales: 698, commission: 184, deductions: 264, channel: 'hepsiburada' }],
    },
  });
  const combined = makeInsights({
    sales: { ...ty.sales, total: 22078, orders: 53 },
    breakdown: { ...ty.breakdown, sales: 22078, remaining: 12386, remainingPct: 56, financeMissing: [] },
    payments: {
      available: true,
      next: hb.payments.next,
      later: { date: TR(2026, 11, 18), amount: 9729, orders: 43, channel: null },
      notDelivered: { amount: 4269, orders: 16 },
      past: [hb.payments.past[0], ty.payments.past[0]],
      queue: [
        { ...hb.payments.next, kind: 'next' },
        { ...ty.payments.next, kind: 'next' },
        { ...hb.payments.later, kind: 'later' },
        { ...ty.payments.later, kind: 'later' },
      ],
    },
  });
  return { ...combined, channels: ['trendyol', 'hepsiburada'], failed: [], byChannel: { trendyol: ty, hepsiburada: hb } };
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
  api.getMarketplaceInsights.mockResolvedValue(makeResponse());
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

  it('özet kanal filtresine göre daralır', () => {
    const all = makeCombined();
    expect(scopeInsights(all, 'all').data).toBe(all);
    expect(scopeInsights(all, 'all').channels).toEqual(['trendyol', 'hepsiburada']);
    expect(scopeInsights(all, 'hb').data).toBe(all.byChannel.hepsiburada);
    expect(scopeInsights(makeResponse(), 'hb')).toEqual({ data: null, channels: ['hepsiburada'], missing: 'absent' });
    expect(scopeInsights(makeResponse({ failed: ['hepsiburada'] }), 'hb').missing).toBe('failed');
    expect(scopeLabel(['trendyol', 'hepsiburada'])).toBe('Trendyol + Hepsiburada');
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

describe('MobileOrders — pazaryeri özeti', () => {
  it('yönetici özeti görür; sekmeler özetin altında; detay açılıp kapanır', async () => {
    renderOrders('owner');
    await screen.findByText('≈ ₺11.367');
    expect(api.getMarketplaceInsights).toHaveBeenCalledWith('ay');

    // Sekmeler özet şeridinden SONRA gelir (listeye bitişik).
    const strip = screen.getByLabelText('Pazaryeri özeti');
    const tabs = screen.getByRole('tablist', { name: 'Sipariş durumu' });
    expect(strip.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(strip).getByText('Sana kalan').closest('button'));
    const page = await screen.findByRole('dialog', { name: 'Sana kalan' });
    expect(within(page).getByText('Nereye gitti?')).toBeTruthy();
    expect(within(page).getByText('14 siparişin kesintileri henüz kesinleşmedi.')).toBeTruthy();
    expect(within(page).getByText('Trendyol komisyonu')).toBeTruthy();
    fireEvent.click(within(page).getByText('KDV').closest('button'));
    expect(within(page).getByText(/Trendyol bunu kesmez/)).toBeTruthy();

    fireEvent.click(within(page).getByRole('button', { name: 'Siparişlere dön' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('dönem değişince o dönemin özeti istenir', async () => {
    renderOrders('admin');
    await screen.findByText('≈ ₺11.367');
    fireEvent.click(screen.getByRole('button', { name: 'Geçen ay' }));
    await waitFor(() => expect(api.getMarketplaceInsights).toHaveBeenCalledWith('gecen'));
  });

  it('asistan özeti görmez ve finans ucu çağrılmaz', async () => {
    renderOrders('assistant');
    await screen.findByText('Ada K.');
    expect(screen.queryByLabelText('Pazaryeri özeti')).toBeNull();
    expect(api.getMarketplaceInsights).not.toHaveBeenCalled();
  });

  it('iki kanal birlikte: toplam, ödemenin kanalı ve kanallara göre döküm', async () => {
    api.getMarketplaceInsights.mockResolvedValue(makeCombined());
    renderOrders('owner');
    await screen.findByText('≈ ₺12.386');
    const strip = screen.getByLabelText('Pazaryeri özeti');
    expect(within(strip).getByText('₺22.078 satıştan')).toBeTruthy();
    // Sıradaki ödeme HB'den (salı) — kart kanalı yazar.
    expect(within(strip).getByText('≈ ₺125')).toBeTruthy();
    expect(within(strip).getByText('Hepsiburada')).toBeTruthy();

    fireEvent.click(within(strip).getByText('Sana kalan').closest('button'));
    const page = await screen.findByRole('dialog', { name: 'Sana kalan' });
    expect(within(page).getByText('Trendyol + Hepsiburada · Bu ay, 1–13 Kasım')).toBeTruthy();
    expect(within(page).getByText('Komisyon')).toBeTruthy();
    expect(within(page).getByText('Kanallara göre')).toBeTruthy();
    expect(within(page).getByText('≈ ₺1.019')).toBeTruthy();
    fireEvent.click(within(page).getByRole('button', { name: 'Siparişlere dön' }));

    fireEvent.click(within(strip).getByText('Sıradaki ödeme').closest('button'));
    const pay = await screen.findByRole('dialog', { name: 'Ödemeler' });
    expect(within(pay).getByText('Trendyol ödemesi')).toBeTruthy();
    expect(within(pay).getByText('Hepsiburada, sonraki ödeme günleri')).toBeTruthy();
    expect(within(pay).getByText(/Trendyol genelde çarşamba, Hepsiburada salı öder/)).toBeTruthy();
  });

  it('kanal filtresi özeti de süzer; yeni istek atılmaz', async () => {
    api.getMarketplaceInsights.mockResolvedValue(makeCombined());
    renderOrders('owner');
    await screen.findByText('≈ ₺12.386');

    fireEvent.click(screen.getByRole('button', { name: 'Kanal filtresi' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hepsiburada' }));
    const strip = screen.getByLabelText('Pazaryeri özeti');
    expect(await within(strip).findByText('≈ ₺1.019')).toBeTruthy();
    expect(within(strip).getByText('₺3.629 satıştan')).toBeTruthy();
    expect(api.getMarketplaceInsights).toHaveBeenCalledTimes(1);

    fireEvent.click(within(strip).getByText('Sana kalan').closest('button'));
    const page = await screen.findByRole('dialog', { name: 'Sana kalan' });
    expect(within(page).getByText('Hepsiburada komisyonu')).toBeTruthy();
    expect(within(page).getByText('Ortalama %22 + KDV')).toBeTruthy();
    expect(within(page).queryByText('Kanallara göre')).toBeNull();
  });

  it('Hepsiburada bağlı değilse HB filtresinde özet yerine not', async () => {
    renderOrders('owner');
    await screen.findByText('≈ ₺11.367');
    fireEvent.click(screen.getByRole('button', { name: 'Kanal filtresi' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hepsiburada' }));
    expect(await screen.findByText('Hepsiburada bağlı değil; özet yok.')).toBeTruthy();
  });

  it('bir kanal alınamazsa özet diğeriyle gelir ve not düşer', async () => {
    const hbOnly = makeCombined().byChannel.hepsiburada;
    api.getMarketplaceInsights.mockResolvedValue({
      ...hbOnly, channels: ['hepsiburada'], failed: ['trendyol'], byChannel: { hepsiburada: hbOnly },
    });
    renderOrders('owner');
    expect(await screen.findByText('Trendyol verisi şu an alınamadı; özet yalnız Hepsiburada.')).toBeTruthy();
    expect(screen.getByText('≈ ₺1.019')).toBeTruthy();
  });
});
