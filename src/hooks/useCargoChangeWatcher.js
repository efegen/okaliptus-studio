import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCargoChangeStatuses } from '../api';
import { queryKeys } from './queryKeys';
import {
  applyCargoChangeStatuses,
  CARGO_WATCH_INTERVAL_MS,
  pendingCargoPackageIds,
} from '../marketplaceOrders';

// Verilen siparişlerde Trendyol onayı bekleyen bir kargo firması değişikliği varsa
// sunucuyu kısa aralıkla yoklar ve dönen durum + taze paket verisini sipariş
// önbelleğine yamar (bkz. marketplaceOrders.js). Böylece liste ve detay ekranı, TY
// değişikliği yansıttığı anda sayfa yenilenmeden güncellenir. Bekleyen kalmayınca
// (applied / unconfirmed) yoklama kendiliğinden durur; sekme arka plandayken durur.
export function useCargoChangeWatcher(orders) {
  const queryClient = useQueryClient();
  const ids = pendingCargoPackageIds(orders);
  const idsKey = ids.join(',');

  const statusQuery = useQuery({
    queryKey: queryKeys.trendyolCargoChanges(idsKey),
    queryFn: () => getCargoChangeStatuses(idsKey.split(',')),
    enabled: idsKey !== '',
    refetchInterval: CARGO_WATCH_INTERVAL_MS,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  React.useEffect(() => {
    if (statusQuery.data) applyCargoChangeStatuses(queryClient, statusQuery.data);
  }, [queryClient, statusQuery.data]);
}
