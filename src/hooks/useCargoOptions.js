// "Kargo Firması Değiştir" modallarının (mobil + web) seçenek kaynağı.
//
// Trendyol: sabit whitelist (CARGO_PROVIDERS), mevcut firma TY adından tanınır.
// Hepsiburada: firma listesi PAKETE göre değişir → HB'nin o paket için döndürdüğü aktif
// firmalar sunucudan çekilir (GET /hepsiburada/orders/cargo-options); mevcut firmanın
// kodunu da sunucu söyler.

import { useQuery } from '@tanstack/react-query';
import { getHepsiburadaCargoOptions } from '../api';
import { CARGO_PROVIDERS, cargoProviderCodeFromName } from '../marketplaceOrders';
import { queryKeys } from './queryKeys';

export function useCargoOptions(order) {
  const isHb = order?.channel === 'hepsiburada';
  const packageId = order?.packageId || '';
  const hbQuery = useQuery({
    queryKey: queryKeys.hepsiburadaCargoOptions(packageId),
    queryFn: () => getHepsiburadaCargoOptions(packageId),
    enabled: isHb && !!packageId,
    staleTime: 60 * 1000,
    retry: false,
  });

  if (!isHb) {
    return {
      options: CARGO_PROVIDERS,
      currentCode: cargoProviderCodeFromName(order ? order.cargoProvider : null),
      isLoading: false,
      error: null,
    };
  }
  return {
    options: hbQuery.data?.options ?? [],
    currentCode: hbQuery.data?.currentCode ?? null,
    isLoading: hbQuery.isLoading,
    error: hbQuery.error || null,
  };
}
