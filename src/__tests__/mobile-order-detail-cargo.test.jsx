import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../api';
import { MobileOrderDetail } from '../mobile/MobileOrderDetail';
import { queryKeys } from '../hooks/queryKeys';

vi.mock('jsbarcode', () => ({ default: vi.fn() }));

vi.mock('../api', () => ({
  getSettings: vi.fn(async () => ({ marketplaceFulfillmentEnabled: true })),
  getTrendyolOrdersList: vi.fn(),
  changeOrderCargoProvider: vi.fn(),
  getCargoChangeStatuses: vi.fn(),
}));

const ORDERS_KEY = queryKeys.trendyolOrders({ windowDays: 90 });

function makeOrder(overrides) {
  return {
    id: 'TY1::P1', channel: 'trendyol', orderNumber: 'TY1', packageId: 'P1', status: 'Created', tab: 'yeni',
    orderDate: Date.now() - 3_600_000, agreedDeliveryDate: null, buyerName: 'Ada K.',
    cargoProvider: 'Aras Kargo Marketplace', cargoTrackingNumber: '7330000000001', cargoTrackingLink: null,
    saleAmount: 100, discount: 0, billable: 100, invoiced: false,
    lines: [{ lineId: '1', quantity: 1, productName: 'Mat', barcode: 'B1' }],
    ...overrides,
  };
}

function change(status, overrides) {
  const requestedAt = Date.now() - 5_000;
  return {
    status, toCode: 'YKMP', toName: 'Yurtiçi Kargo', fromName: 'Aras Kargo Marketplace',
    fromTrackingNumber: '7330000000001', requestedAt, appliedAt: status === 'applied' ? Date.now() : null,
    confirmDeadline: requestedAt + 600_000,
    ...overrides,
  };
}

function renderDetail(openedOrder, cachedOrders) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cachedOrders) {
    client.setQueryData(ORDERS_KEY, { orders: cachedOrders, tabCounts: { tum: cachedOrders.length }, total: cachedOrders.length });
  }
  const utils = render(
    <QueryClientProvider client={client}>
      <MobileOrderDetail order={openedOrder} onBack={() => {}} />
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

function cargoSection() {
  return screen.getByText('Kargo Bilgileri').closest('section');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getSettings.mockResolvedValue({ marketplaceFulfillmentEnabled: true });
});

describe('MobileOrderDetail — kargo firması değişikliği', () => {
  it('açılıştaki donuk kopya yerine önbellekteki güncel firmayı gösterir', async () => {
    const opened = makeOrder();
    const updated = makeOrder({ cargoProvider: 'Yurtiçi Kargo Marketplace' });
    api.getTrendyolOrdersList.mockResolvedValue({ orders: [updated], tabCounts: {}, total: 1 });
    renderDetail(opened, [updated]);

    expect(within(cargoSection()).getByText('Yurtiçi Kargo Marketplace')).toBeInTheDocument();
    expect(within(cargoSection()).queryByAltText('Aras Kargo Marketplace')).toBeNull();
  });

  it('onay beklerken durumu gösterir, TY yansıtınca yeni firma ve kargo koduyla güncellenir', async () => {
    const opened = makeOrder({ cargoChange: change('pending') });
    const fresh = makeOrder({ cargoProvider: 'Yurtiçi Kargo Marketplace', cargoTrackingNumber: '7330000000002' });
    const appliedChange = change('applied');
    api.getTrendyolOrdersList.mockResolvedValue({ orders: [opened], tabCounts: {}, total: 1 });
    api.getCargoChangeStatuses.mockResolvedValue([
      { packageId: 'P1', change: appliedChange, order: { ...fresh, cargoChange: appliedChange } },
    ]);

    renderDetail(opened, [opened]);
    expect(screen.getByText(/için Trendyol onayı bekleniyor/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/olarak güncellendi/)).toBeInTheDocument());
    expect(api.getCargoChangeStatuses).toHaveBeenCalledWith(['P1']);
    expect(within(cargoSection()).getAllByText('Yurtiçi Kargo Marketplace').length).toBeGreaterThan(0);
    expect(within(cargoSection()).getByText('7330000000002')).toBeInTheDocument();
    expect(screen.getByText(/Kargo kodu da değişti/)).toBeInTheDocument();
    expect(screen.queryByText(/onayı bekleniyor/)).toBeNull();
  });

  it('yansımadıysa uyarır ve "Tekrar kontrol et" hedefli kontrol ister', async () => {
    const opened = makeOrder({ cargoChange: change('unconfirmed') });
    api.getTrendyolOrdersList.mockResolvedValue({ orders: [opened], tabCounts: {}, total: 1 });
    api.getCargoChangeStatuses.mockResolvedValue([{ packageId: 'P1', change: change('unconfirmed'), order: opened }]);

    renderDetail(opened, [opened]);
    expect(screen.getByText('Trendyol değişikliği henüz yansıtmadı')).toBeInTheDocument();
    // unconfirmed kendiliğinden yoklanmaz; yalnız kullanıcı isteyince.
    expect(api.getCargoChangeStatuses).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tekrar kontrol et' }));
    await waitFor(() => expect(api.getCargoChangeStatuses).toHaveBeenCalledWith(['P1'], { check: true }));
  });

  it('değişiklik gönderilince "iletildi" der ve siparişi onay beklemeye alır', async () => {
    const opened = makeOrder();
    const pendingChange = change('pending');
    api.getTrendyolOrdersList.mockResolvedValue({ orders: [opened], tabCounts: {}, total: 1 });
    api.changeOrderCargoProvider.mockResolvedValue({
      packageId: 'P1', cargoProvider: 'YKMP', name: 'Yurtiçi Kargo', change: pendingChange,
    });
    api.getCargoChangeStatuses.mockResolvedValue([{ packageId: 'P1', change: pendingChange, order: opened }]);

    renderDetail(opened, [opened]);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'İşlemler' }));
    fireEvent.click(screen.getByRole('button', { name: /Kargo Firması Değiştir/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Yurtiçi Kargo/ })).not.toBeDisabled());
    expect(screen.getByRole('radio', { name: /Aras Kargo/ })).toBeDisabled(); // mevcut firma
    fireEvent.click(screen.getByRole('radio', { name: /Yurtiçi Kargo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Değiştir' }));

    await waitFor(() => expect(screen.getByText(/Trendyol'a iletildi/)).toBeInTheDocument());
    expect(api.changeOrderCargoProvider).toHaveBeenCalledWith({ packageId: 'P1', cargoProvider: 'YKMP', orderNumber: 'TY1' });
    expect(screen.getByText(/için Trendyol onayı bekleniyor/)).toBeInTheDocument();
    await waitFor(() => expect(api.getCargoChangeStatuses).toHaveBeenCalledWith(['P1']));
  });

  it('bekleyen değişiklik varken de yeni değişiklik gönderilebilir; Trendyol reddederse hatası görünür', async () => {
    const opened = makeOrder({ cargoChange: change('pending') });
    api.getTrendyolOrdersList.mockResolvedValue({ orders: [opened], tabCounts: {}, total: 1 });
    api.getCargoChangeStatuses.mockResolvedValue([{ packageId: 'P1', change: change('pending'), order: opened }]);
    api.changeOrderCargoProvider.mockRejectedValue(new Error('Trendyol kargo firması değiştirilemedi (HTTP 400).'));

    renderDetail(opened, [opened]);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'İşlemler' }));
    fireEvent.click(screen.getByRole('button', { name: /Kargo Firması Değiştir/ }));

    await waitFor(() => expect(screen.getByRole('radio', { name: /PTT Kargo/ })).not.toBeDisabled());
    expect(screen.queryByText(/5 dakikada/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /PTT Kargo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Değiştir' }));

    await waitFor(() => expect(screen.getByText(/HTTP 400/)).toBeInTheDocument());
    expect(api.changeOrderCargoProvider).toHaveBeenCalledWith({ packageId: 'P1', cargoProvider: 'PTTMP', orderNumber: 'TY1' });
  });
});
