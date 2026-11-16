import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('../api', () => ({ getCargoChangeStatuses: vi.fn() }));

import {
  applyCargoChangeStatuses,
  canChangeCargo,
  cargoProviderCodeFromName,
  findOrderIn,
  mergeOrderLists,
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

describe('mergeOrderLists', () => {
  it('iki kanalı tarihe göre birleştirir, sekme sayılarını toplar', () => {
    const ty = { orders: [order({ id: 'T1', channel: 'trendyol', orderDate: 100 }), order({ id: 'T2', channel: 'trendyol', orderDate: 300 })], tabCounts: { tum: 2, yeni: 2 }, total: 2 };
    const hb = { orders: [order({ id: 'H1', channel: 'hepsiburada', orderDate: 200, tab: 'teslim' })], tabCounts: { tum: 1, teslim: 1 }, total: 1, configured: true };
    const merged = mergeOrderLists(ty, hb);
    expect(merged.orders.map(o => o.id)).toEqual(['T2', 'H1', 'T1']);
    expect(merged.tabCounts).toEqual({ tum: 3, yeni: 2, teslim: 1 });
    expect(merged.total).toBe(3);
  });

  it('yalnız biri geldiyse onu, hiçbiri yoksa undefined döndürür', () => {
    expect(mergeOrderLists(undefined, undefined)).toBeUndefined();
    const only = mergeOrderLists({ orders: [order()], tabCounts: { tum: 1 } }, undefined);
    expect(only.total).toBe(1);
  });
});

describe('kanal ayrımı', () => {
  it('kargo değiştirilebilirlik: Trendyol teslim hariç, Hepsiburada yalnız Yeni + paket', () => {
    expect(canChangeCargo(order({ tab: 'tasima' }))).toBe(true);
    expect(canChangeCargo(order({ tab: 'teslim' }))).toBe(false);
    expect(canChangeCargo(order({ channel: 'hepsiburada', tab: 'yeni' }))).toBe(true);
    expect(canChangeCargo(order({ channel: 'hepsiburada', tab: 'tasima' }))).toBe(false);
    expect(canChangeCargo(order({ channel: 'hepsiburada', tab: 'yeni', packageId: null }))).toBe(false);
  });

  it('bekleyenleri kanala göre ayırır, Hepsiburada önbelleğine yamar', () => {
    const ty = order({ packageId: 'P1', cargoChange: pending });
    const hb = order({ id: 'hb:O2::P2', orderNumber: 'O2', packageId: 'P2', channel: 'hepsiburada', cargoChange: pending });
    expect(pendingCargoPackageIds([ty, hb], 'trendyol')).toEqual(['P1']);
    expect(pendingCargoPackageIds([ty, hb], 'hepsiburada')).toEqual(['P2']);

    const client = new QueryClient();
    const hbKey = queryKeys.hepsiburadaOrders({ windowDays: 90 });
    client.setQueryData(hbKey, { orders: [hb], tabCounts: { tum: 1 }, total: 1 });
    const fresh = { ...hb, cargoProvider: 'Aras Kargo' };
    expect(applyCargoChangeStatuses(client, [{ packageId: 'P2', change: applied, order: fresh }], 'hepsiburada')).toBe(true);
    expect(client.getQueryData(hbKey).orders[0].cargoProvider).toBe('Aras Kargo');
    expect(applyCargoChangeStatuses(client, [{ packageId: 'P2', change: applied, order: fresh }], 'trendyol')).toBe(false);
  });
});

describe('findOrderIn — kanallar', () => {
  it('aynı paket no başka kanaldaysa onu döndürmez', () => {
    const hb = order({ id: 'hb:O1::P1', channel: 'hepsiburada' });
    expect(findOrderIn([hb], order({ id: 'X', channel: 'trendyol' }))).toBeNull();
    expect(findOrderIn([hb], order({ id: 'Y', channel: 'hepsiburada' }))).toBe(hb);
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
