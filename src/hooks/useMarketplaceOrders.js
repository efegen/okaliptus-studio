// Siparişler ekranlarının ortak veri kaynağı: Trendyol ve Hepsiburada sipariş
// listelerini İKİ AYRI sorguyla çeker, tek listede birleştirir (mergeOrderLists).
//
// Sorgu anahtarları kanal başına ayrıdır (queryKeys.trendyolOrders /
// hepsiburadaOrders) → mobil liste, detay, ana sayfa ve web aynı önbelleği paylaşır;
// kargo değişikliği takibi (yalnız Trendyol) kendi anahtarına yamamaya devam eder.
// Bir kanal düşerse diğerinin siparişleri yine gösterilir (failedChannel ile bildirilir).
//
// params: { windowDays } ya da { startDate, endDate } (web tarih filtresi).

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHepsiburadaOrdersList, getTrendyolOrdersList } from '../api';
import { CHANNEL_LABELS, mergeOrderLists } from '../marketplaceOrders';
import { queryKeys } from './queryKeys';

export function useMarketplaceOrders(params, { enabled = true, staleTime = 30 * 1000 } = {}) {
  // "Yenile" bir sonraki sorgularda sunucu anlık önbelleğini baypas etsin diye işaretlenir;
  // normal açılışlar snapshot'tan anında gelir.
  const forceRef = React.useRef({ trendyol: false, hepsiburada: false });
  const takeForce = (channel) => {
    const force = forceRef.current[channel];
    forceRef.current[channel] = false;
    return force;
  };

  const ty = useQuery({
    queryKey: queryKeys.trendyolOrders(params),
    queryFn: () => getTrendyolOrdersList({ ...params, force: takeForce('trendyol') }),
    staleTime,
    enabled,
  });
  const hb = useQuery({
    queryKey: queryKeys.hepsiburadaOrders(params),
    queryFn: () => getHepsiburadaOrdersList({ ...params, force: takeForce('hepsiburada') }),
    staleTime,
    enabled,
  });

  const data = React.useMemo(() => mergeOrderLists(ty.data, hb.data), [ty.data, hb.data]);
  const loading = ty.isLoading || hb.isLoading;
  const failed = ty.isError ? 'trendyol' : hb.isError ? 'hepsiburada' : null;
  // "Son güncelleme": iki listeden ESKİ olanı (dürüst tazelik).
  const stamps = [ty.dataUpdatedAt, hb.dataUpdatedAt].filter(Boolean);

  return {
    data,
    isLoading: !data && loading,
    isFetching: ty.isFetching || hb.isFetching,
    isError: !data && !loading && (ty.isError || hb.isError),
    error: ty.error || hb.error,
    // Yalnız bir kanal düştüyse (diğerinin verisi gösteriliyor) o kanalın adı.
    failedChannel: data && failed ? CHANNEL_LABELS[failed] : null,
    dataUpdatedAt: stamps.length ? Math.min(...stamps) : 0,
    refresh() {
      forceRef.current = { trendyol: true, hepsiburada: true };
      ty.refetch();
      hb.refetch();
    },
  };
}
