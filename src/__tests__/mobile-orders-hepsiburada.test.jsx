import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../api';
import { CurrentUserProvider } from '../currentUser';
import { MobileOrders } from '../mobile/MobileOrders';
import { MobileOrderDetail } from '../mobile/MobileOrderDetail';
import { queryKeys } from '../hooks/queryKeys';

vi.mock('jsbarcode', () => ({ default: vi.fn() }));

vi.mock('../api', () => ({
  getSettings: vi.fn(async () => ({ marketplaceFulfillmentEnabled: true })),
  getTrendyolOrdersList: vi.fn(),
  getHepsiburadaOrdersList: vi.fn(),
  getTrendyolInsights: vi.fn(async () => null),
  getCargoChangeStatuses: vi.fn(async () => []),
  changeOrderCargoProvider: vi.fn(),
  getHepsiburadaCargoOptions: vi.fn(),
  changeHepsiburadaCargoCompany: vi.fn(),
  getHepsiburadaCargoChangeStatuses: vi.fn(async () => []),
}));

function tyOrder(overrides) {
  return {
    id: 'TY1::P1', channel: 'trendyol', orderNumber: 'TY1', packageId: 'P1', status: 'Created', tab: 'yeni',
    orderDate: Date.now() - 3_600_000, agreedDeliveryDate: null, buyerName: 'Ada K.', city: 'İzmir',
    cargoProvider: 'Aras Kargo Marketplace', cargoTrackingNumber: '7330000000001', saleAmount: 100, discount: 0,
    billable: 100, invoiced: false, lines: [{ lineId: '1', quantity: 1, productName: 'Mat', barcode: 'B1' }],
    ...overrides,
  };
}

function hbOrder(overrides) {
  return {
    id: 'hb:H1::5543825643', channel: 'hepsiburada', orderNumber: 'H1', packageId: '5543825643', status: 'Delivered',
    tab: 'teslim', orderDate: Date.now() - 7_200_000, agreedDeliveryDate: null, lastModifiedDate: Date.now() - 600_000,
    buyerName: 'Nil T.', city: 'Denizli', district: 'Pamukkale', cargoProvider: 'PTT Kargo',
    cargoTrackingNumber: '62455438256437', cargoTrackingLink: 'https://ptt.example/KP1', saleAmount: 349, discount: 0,
    billable: 349, invoiced: true, returnRequested: true,
    lines: [{ lineId: 'h1', quantity: 1, productName: 'Lotus Buhurdanlık', merchantSku: 'BUH-KRM-01', imageUrl: 'https://img.example/1.jpg' }],
    ...overrides,
  };
}

function wrap(children, client) {
  return (
    <QueryClientProvider client={client}>
      <CurrentUserProvider user={{ id: 1, username: 'u', role: 'assistant' }}>{children}</CurrentUserProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTrendyolOrdersList.mockResolvedValue({ orders: [tyOrder()], tabCounts: { tum: 1, yeni: 1 }, total: 1 });
  api.getHepsiburadaOrdersList.mockResolvedValue({
    orders: [hbOrder()], tabCounts: { tum: 1, teslim: 1 }, total: 1, configured: true,
  });
});

describe('MobileOrders — Hepsiburada', () => {
  it('iki kanalın siparişlerini birlikte sayar ve gösterir; iade notu kartta', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(wrap(<MobileOrders onBack={() => {}} onOpenDetail={() => {}} />, client));

    await screen.findByText('Ada K.');
    const tabs = screen.getByRole('tablist', { name: 'Sipariş durumu' });
    expect(within(tabs).getByText('Tümü').closest('button')).toHaveTextContent('2 paket');

    fireEvent.click(within(tabs).getByText('Teslim Edilen'));
    const card = (await screen.findByText('#H1')).closest('article');
    expect(within(card).getByText('Hepsiburada')).toBeTruthy();
    expect(within(card).getByText('Müşteri iade talebi açtı')).toBeTruthy();
    expect(api.getHepsiburadaOrdersList).toHaveBeenCalledWith({ windowDays: 90, force: false });
  });

  it('kanal filtresi yalnız Hepsiburada siparişlerini bırakır', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(wrap(<MobileOrders onBack={() => {}} onOpenDetail={() => {}} />, client));
    await screen.findByText('Ada K.');

    fireEvent.click(within(screen.getByRole('tablist', { name: 'Sipariş durumu' })).getByText('Tümü'));
    fireEvent.click(screen.getByRole('button', { name: 'Kanal filtresi' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Hepsiburada/ }));
    await waitFor(() => expect(screen.queryByText('Ada K.')).toBeNull());
    expect(screen.getByText('#H1')).toBeTruthy();
  });

  it('Hepsiburada düşerse Trendyol siparişleri yine görünür, uyarı çıkar', async () => {
    api.getHepsiburadaOrdersList.mockRejectedValue(new Error('HB kapalı'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(wrap(<MobileOrders onBack={() => {}} onOpenDetail={() => {}} />, client));
    await screen.findByText('Ada K.');
    expect(await screen.findByText('Hepsiburada siparişleri alınamadı; yalnız diğer kanal gösteriliyor.')).toBeTruthy();
  });
});

describe('MobileOrderDetail — Hepsiburada', () => {
  it('iade notu, kanal adıyla kargo kodu; kargoya verilmiş pakette firma değiştirilemez', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const order = hbOrder();
    client.setQueryData(queryKeys.hepsiburadaOrders({ windowDays: 90 }), { orders: [order], tabCounts: { tum: 1 }, total: 1 });
    render(wrap(<MobileOrderDetail order={order} onBack={() => {}} />, client));

    expect(screen.getByText('Müşteri iade talebi açtı')).toBeTruthy();
    expect(screen.getByText('62455438256437')).toBeTruthy();
    expect(screen.getByText('Hepsiburada Anlaşmalı Kargo')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Kargo Etiketini Yazdır/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'İşlemler' }));
    const sheet = screen.getByRole('dialog', { name: 'İşlemler' });
    expect(within(sheet).getByText('Kargo Firması Değiştir').closest('button')).toBeDisabled();
  });

  it('kargoya hazır pakette firma Hepsiburada seçeneklerinden değiştirilir, onay beklenir', async () => {
    const order = hbOrder({ id: 'hb:H2::5000000002', orderNumber: 'H2', packageId: '5000000002', tab: 'yeni', status: 'Open',
      returnRequested: false, cargoProvider: 'Yurtiçi Kargo', cargoTrackingNumber: '6210001', invoiced: false });
    api.getHepsiburadaCargoOptions.mockResolvedValue({
      packageId: '5000000002', currentCode: 'YK',
      options: [{ code: 'YK', name: 'Yurtiçi Kargo', logoUrl: null }, { code: 'AR', name: 'Aras Kargo', logoUrl: null }],
    });
    const change = { status: 'pending', toCode: 'AR', toName: 'Aras Kargo', fromName: 'Yurtiçi Kargo', fromTrackingNumber: '6210001',
      requestedAt: Date.now(), appliedAt: null, confirmDeadline: Date.now() + 600_000 };
    api.changeHepsiburadaCargoCompany.mockResolvedValue({ packageId: '5000000002', cargoProvider: 'AR', name: 'Aras Kargo', change, order: { ...order, cargoChange: change } });
    api.getHepsiburadaCargoChangeStatuses.mockResolvedValue([{ packageId: '5000000002', change, order: { ...order, cargoChange: change } }]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.hepsiburadaOrders({ windowDays: 90 }), { orders: [order], tabCounts: { tum: 1 }, total: 1 });
    render(wrap(<MobileOrderDetail order={order} onBack={() => {}} />, client));

    fireEvent.click(screen.getByRole('button', { name: 'İşlemler' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'İşlemler' })).getByText('Kargo Firması Değiştir'));
    const modal = await screen.findByRole('dialog', { name: 'Kargo Firması Değiştir' });
    const aras = await within(modal).findByRole('radio', { name: /Aras Kargo/ });
    expect(within(modal).getByRole('radio', { name: /Yurtiçi Kargo/ })).toBeDisabled();
    fireEvent.click(aras);
    fireEvent.click(within(modal).getByRole('button', { name: 'Değiştir' }));

    await waitFor(() => expect(api.changeHepsiburadaCargoCompany).toHaveBeenCalledWith({ packageId: '5000000002', cargoCompany: 'AR', orderNumber: 'H2' }));
    expect(api.changeOrderCargoProvider).not.toHaveBeenCalled();
    expect(await screen.findByText("Hepsiburada'ya iletildi — onay bekleniyor", { exact: false })).toBeTruthy();
    expect(await screen.findByText(/için Hepsiburada onayı bekleniyor/)).toBeTruthy();
  });
});
