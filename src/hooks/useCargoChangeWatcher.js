import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCargoChangeStatuses, getHepsiburadaCargoChangeStatuses } from '../api';
import { queryKeys } from './queryKeys';
import {
  applyCargoChangeStatuses,
  CARGO_WATCH_INTERVAL_MS,
  pendingCargoPackageIds,
} from '../marketplaceOrders';

// Verilen siparişlerde pazaryeri onayı bekleyen bir kargo firması değişikliği varsa
// sunucuyu kısa aralıkla yoklar ve dönen durum + taze paket verisini sipariş
// önbelleğine yamar (bkz. marketplaceOrders.js). Böylece liste ve detay ekranı,
// pazaryeri değişikliği yansıttığı anda sayfa yenilenmeden güncellenir. Trendyol ve
// Hepsiburada ayrı uçlardan, ayrı önbelleklere yoklanır. Bekleyen kalmayınca
// (applied / unconfirmed) yoklama kendiliğinden durur; sekme arka plandayken durur.
function useChannelWatcher(orders, channel, queryKey, fetchStatuses) {
  const queryClient = useQueryClient();
  const idsKey = pendingCargoPackageIds(orders, channel).join(',');

  const statusQuery = useQuery({
    queryKey: queryKey(idsKey),
    queryFn: () => fetchStatuses(idsKey.split(',')),
    enabled: idsKey !== '',
    refetchInterval: CARGO_WATCH_INTERVAL_MS,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  React.useEffect(() => {
    if (statusQuery.data) applyCargoChangeStatuses(queryClient, statusQuery.data, channel);
  }, [queryClient, statusQuery.data, channel]);
}

export function useCargoChangeWatcher(orders) {
  useChannelWatcher(orders, 'trendyol', queryKeys.trendyolCargoChanges, (ids) => getCargoChangeStatuses(ids));
  useChannelWatcher(orders, 'hepsiburada', queryKeys.hepsiburadaCargoChanges, (ids) => getHepsiburadaCargoChangeStatuses(ids));
}
