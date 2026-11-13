import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SiteStorePage, siteStatus } from '../siteStore';
import { queryKeysForWrite } from '../hooks/writeInvalidation';
import * as api from '../api';

// Site mağazası ekranı (siteStore.jsx): okaliptusyoga.com/magaza'da hangi
// Trendyol ürününün, hangi köşede ve hangi adla görüneceği.

vi.mock('../api', () => ({
  getSiteProducts: vi.fn(),
  updateSiteProduct: vi.fn(),
  syncTrendyolProducts: vi.fn(),
}));

function product(overrides = {}) {
  return {
    key: 'LOTUS',
    title: 'Lotus Buhurdanlık Seramik Turuncu',
    displayName: null,
    name: 'Lotus Buhurdanlık Seramik Turuncu',
    hidden: false,
    corner: null,
    autoCorner: 'meditasyon',
    effectiveCorner: 'meditasyon',
    sellable: true,
    inStock: true,
    price: 299,
    listPrice: 349,
    fromPrice: false,
    variantCount: 1,
    imageUrl: 'https://cdn.dsmcdn.com/a.jpg',
    productUrl: 'https://www.trendyol.com/x/lotus-p-1',
    syncedAt: '2026-11-14T09:00:00Z',
    ...overrides,
  };
}

function renderPage(products) {
  api.getSiteProducts.mockResolvedValue({ syncedAt: '2026-11-14T09:00:00Z', products });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SiteStorePage />
    </QueryClientProvider>,
  );
}

describe('siteStatus', () => {
  it('shows only sellable, visible products with a listing link', () => {
    expect(siteStatus(product()).onSite).toBe(true);
    expect(siteStatus(product({ hidden: true }))).toEqual({ onSite: false, note: 'Gizli' });
    expect(siteStatus(product({ sellable: false })).onSite).toBe(false);
    expect(siteStatus(product({ productUrl: null })).onSite).toBe(false);
    expect(siteStatus(product({ inStock: false }))).toEqual({ onSite: true, note: 'Stokta yok' });
  });
});

describe('SiteStorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists products with a summary and filters by search ignoring Turkish letters', async () => {
    renderPage([
      product(),
      product({ key: 'PALO', title: 'Palo Santo Tütsü', name: 'Palo Santo Tütsü', hidden: true, autoCorner: 'arinma', effectiveCorner: 'arinma' }),
    ]);
    expect(await screen.findByLabelText('Lotus Buhurdanlık Seramik Turuncu köşesi')).toBeTruthy();
    expect(screen.getByText('ürün sitede', { exact: false })).toBeTruthy();
    expect(screen.getByText('Gizli')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Ürün ara'), { target: { value: 'tutsu' } });
    expect(screen.getByText('1 ürün')).toBeTruthy();
    expect(screen.getByLabelText('Palo Santo Tütsü köşesi')).toBeTruthy();
    expect(screen.queryByLabelText('Lotus Buhurdanlık Seramik Turuncu köşesi')).toBeNull();
  });

  it('saves hide, corner and name changes', async () => {
    api.updateSiteProduct.mockImplementation(async (key, patch) => product({ ...patch }));
    renderPage([product()]);

    const toggle = await screen.findByRole('checkbox', { name: 'Sitede' });
    fireEvent.click(toggle);
    await waitFor(() => expect(api.updateSiteProduct).toHaveBeenCalledWith('LOTUS', { hidden: true }));

    fireEvent.change(screen.getByLabelText('Lotus Buhurdanlık Seramik Turuncu köşesi'), { target: { value: 'taslar' } });
    await waitFor(() => expect(api.updateSiteProduct).toHaveBeenCalledWith('LOTUS', { corner: 'taslar' }));

    const name = screen.getByLabelText('Lotus Buhurdanlık Seramik Turuncu için sitede görünen ad');
    fireEvent.change(name, { target: { value: '  Lotus Buhurdanlık  ' } });
    fireEvent.blur(name);
    await waitFor(() => expect(api.updateSiteProduct).toHaveBeenCalledWith('LOTUS', { displayName: 'Lotus Buhurdanlık' }));
  });

  it('refreshes the site list after a site write', () => {
    expect(queryKeysForWrite('PATCH', '/site-products/LOTUS')).toEqual([['siteProducts']]);
  });
});
