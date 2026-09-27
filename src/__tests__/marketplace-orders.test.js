import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('../api', () => ({ getCargoChangeStatuses: vi.fn() }));

import {
  applyCargoChangeStatuses,
  cargoProviderCodeFromName,
  findOrderIn,
  patchOrdersList,
  pendingCargoPackageIds,
} from '../marketplaceOrders';
import { queryKeys } from '../hooks/queryKeys';

const pending = { status: 'pending', toCode: 'YKMP', toName: 'Yurtiçi Kargo', requestedAt: 1000 };
const applied = { ...pending, status: 'applied', appliedAt: 5000 };

function order(overrides) {
  return {
    id: 'O1::P1', orderNumber: 'O1', packageId: 'P1', tab: 'yeni',
    cargoProvider: 'Aras Kargo Marketplace', cargoTrackingNumber: '111', lines: [],
    ...overrides,
  };
}

describe('cargoProviderCodeFromName', () => {
  it('Trendyol firma adlarını whitelist koduna çözer', () => {
    expect(cargoProviderCodeFromName('Yurtiçi Kargo Marketplace')).toBe('YKMP');
    expect(cargoProviderCodeFromName('YURTİÇİ KARGO')).toBe('YKMP');
    expect(cargoProviderCodeFromName('PTT Kargo Marketplace')).toBe('PTTMP');
    expect(cargoProviderCodeFromName('Trendyol Express')).toBe('TEXMP');
    expect(cargoProviderCodeFromName('Karaaslan Lojistik')).toBeNull();
    expect(cargoProviderCodeFromName(null)).toBeNull();
  });
});

describe('takip yardımcıları', () => {
  it('yalnız bekleyen paketleri yoklamaya alır', () => {
    const orders = [
      order({ packageId: 'P2', cargoChange: pending }),
      order({ packageId: 'P1', cargoChange: pending }),
      order({ packageId: 'P3', cargoChange: applied }),
      order({ packageId: 'P4' }),
    ];
    expect(pendingCargoPackageIds(orders)).toEqual(['P1', 'P2']);
  });

  it('açılan siparişi id → paket no → tek paketli sipariş no ile bulur', () => {
    const renumbered = order({ id: 'O1::P9', packageId: 'P9' });
    expect(findOrderIn([renumbered], order())).toBe(renumbered);
    expect(findOrderIn([order({ id: 'O1::P9', packageId: 'P9' }), order({ id: 'O1::P8', packageId: 'P8' })], order())).toBeNull();
  });
});

describe('patchOrdersList', () => {
  const data = { orders: [order(), order({ id: 'O2::P2', orderNumber: 'O2', packageId: 'P2' })], tabCounts: { tum: 2, yeni: 2 }, total: 2 };

  it('değişiklik yoksa aynı nesneyi döndürür', () => {
    expect(patchOrdersList(data, [{ packageId: 'P1', change: null, order: null }])).toBe(data);
    expect(patchOrdersList(data, [{ packageId: 'YOK', change: pending, order: null }])).toBe(data);
  });

  it('takip durumunu iliştirir, taze paketi yerleştirir, sekme sayısını düzeltir', () => {
    const marked = patchOrdersList(data, [{ packageId: 'P1', change: pending, order: null }]);
    expect(marked.orders[0].cargoChange).toBe(pending);
    expect(marked.orders[1]).toBe(data.orders[1]);

    const fresh = order({ cargoProvider: 'Yurtiçi Kargo Marketplace', cargoTrackingNumber: '222', tab: 'isleme' });
    const done = patchOrdersList(marked, [{ packageId: 'P1', change: applied, order: fresh }]);
    expect(done.orders[0].cargoProvider).toBe('Yurtiçi Kargo Marketplace');
    expect(done.orders[0].cargoTrackingNumber).toBe('222');
    expect(done.orders[0].cargoChange).toBe(applied);
    expect(done.tabCounts).toEqual({ tum: 2, yeni: 1, isleme: 1 });

    const cleared = patchOrdersList(done, [{ packageId: 'P1', change: null, order: null }]);
    expect('cargoChange' in cleared.orders[0]).toBe(false);
  });
});

describe('applyCargoChangeStatuses', () => {
  it('tüm sipariş önbelleklerini yamar, "Son güncelleme" zamanını korur', () => {
    const client = new QueryClient();
    const keyA = queryKeys.trendyolOrders({ windowDays: 90 });
    const keyB = queryKeys.trendyolOrders({ windowDays: 30 });
    client.setQueryData(keyA, { orders: [order()], tabCounts: { tum: 1, yeni: 1 }, total: 1 }, { updatedAt: 1234 });
    client.setQueryData(keyB, { orders: [order()], tabCounts: { tum: 1, yeni: 1 }, total: 1 }, { updatedAt: 5678 });

    const found = applyCargoChangeStatuses(client, [{ packageId: 'P1', change: pending, order: null }]);

    expect(found).toBe(true);
    expect(client.getQueryData(keyA).orders[0].cargoChange).toBe(pending);
    expect(client.getQueryData(keyB).orders[0].cargoChange).toBe(pending);
    expect(client.getQueryState(keyA).dataUpdatedAt).toBe(1234);
    expect(client.getQueryState(keyB).dataUpdatedAt).toBe(5678);
    expect(applyCargoChangeStatuses(client, [{ packageId: 'YOK', change: pending, order: null }])).toBe(false);
  });
});
