import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../api';

vi.mock('../api', () => ({
  getSettings: vi.fn(async () => ({ weeklyCapacity: 25 })),
  getTrendyolOrdersList: vi.fn(async () => ({ orders: [], tabCounts: {} })),
  getNotes: vi.fn(),
  markNotesSeen: vi.fn(async () => {}),
  getNoteImage: vi.fn(),
}));

vi.mock('../mobile/shared/useWeeklyKpi', () => ({
  useWeeklyKpi: () => ({ data: null, isLoading: false }),
  parseNumericValue: (v, fallback = null) => (v == null ? fallback : Number(v)),
}));

vi.mock('../mobile/shared/useWeekLessons', () => ({
  useWeekLessons: () => ({ sessions: [] }),
}));

vi.mock('../mobile/home/MobileAgenda', () => ({ MobileAgenda: () => null }));

const now = new Date().toISOString();

function note(overrides) {
  return {
    id: '1',
    author_user_id: '20',
    author_name: 'Selin Ak',
    body: 'Not',
    parent_note_id: null,
    category: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    mentions: [],
    user_mentions: [],
    reactions: [],
    has_image: false,
    image_updated_at: null,
    seen_count: 0,
    seen_by_me: false,
    ...overrides,
  };
}

// Deste oturum durumu modül düzeyinde tutulduğu için her testte modül tazelenir.
async function renderHome(user, props = {}) {
  vi.resetModules();
  const { MobileHome } = await import('../mobile/MobileHome');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MobileHome user={user} onOpenNotes={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

const admin = { id: '10', displayName: 'Efe', role: 'admin' };
const assistant = { id: '10', displayName: 'Efe', role: 'assistant' };

describe('Ana sayfa not destesi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('yalnız görülmemiş, başkasının yazdığı üst notları gösterir; etiketli not önce gelir', async () => {
    api.getNotes.mockResolvedValue([
      note({ id: '5', body: 'En yeni', created_at: '2026-09-23T10:00:00Z' }),
      note({ id: '4', body: 'Kendi notum', author_user_id: '10' }),
      note({ id: '3', body: 'Görülmüş', seen_by_me: true }),
      note({ id: '2', body: 'Yanıt', parent_note_id: '1' }),
      note({ id: '1', body: 'Sana @{u:10} bak', created_at: '2026-09-22T10:00:00Z', user_mentions: [{ userId: '10', name: 'Efe' }] }),
    ]);
    await renderHome(admin);

    expect(await screen.findByText('2 okunmamış')).toBeInTheDocument();
    // Üst kart etiketli not: SANA rozeti + "Yanıtla"; 1 yanıt meta satırında.
    expect(screen.getByText('SANA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yanıtla' })).toBeInTheDocument();
    expect(screen.getByText('@Efe')).toBeInTheDocument();
    expect(screen.getByText(/1 yanıt/)).toBeInTheDocument();
    expect(screen.queryByText('Kendi notum')).not.toBeInTheDocument();
    // Yönetici: deste varken KPI hero'su ve Notlar kutusu gizli.
    expect(screen.queryByText('Son 30 günde tahsil edilen')).not.toBeInTheDocument();
  });

  it('"Gördüm" notu görüldü işaretler ve deste bitince KPI\'lar geri gelir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.getNotes.mockResolvedValue([note({ id: '7', body: 'Matlar yıprandı' })]);
      await renderHome(admin);

      fireEvent.click(await screen.findByRole('button', { name: 'Gördüm' }));
      await act(async () => { vi.advanceTimersByTime(300); });

      expect(api.markNotesSeen).toHaveBeenCalledWith(['7']);
      await waitFor(() => expect(screen.queryByText('Matlar yıprandı')).not.toBeInTheDocument());
      expect(screen.getByText('Son 30 günde tahsil edilen')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Aç" notu görüldü işaretleyip o nota yönlendirir', async () => {
    const onOpenNotes = vi.fn();
    api.getNotes.mockResolvedValue([note({ id: '8', body: 'Kapı açık' })]);
    await renderHome(admin, { onOpenNotes });

    fireEvent.click(await screen.findByRole('button', { name: 'Aç' }));
    expect(api.markNotesSeen).toHaveBeenCalledWith(['8']);
    expect(onOpenNotes).toHaveBeenCalledWith({ noteId: '8', reply: false });
  });

  it('görüldü isteği başarısız olursa uygulama yeniden açılınca not gizli kalır ve istek tekrarlanır', async () => {
    api.getNotes.mockResolvedValue([note({ id: '8', body: 'Kapı açık' }), note({ id: '7', body: 'Diğer' })]);
    api.markNotesSeen.mockRejectedValueOnce(new Error('ağ yok'));
    const first = await renderHome(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Aç' }));
    await waitFor(() => expect(api.markNotesSeen).toHaveBeenCalledWith(['8']));
    first.unmount();

    // Uygulama yeniden açıldı (modül durumu sıfır); sunucu hâlâ görmedi diyor.
    await renderHome(admin);
    expect(await screen.findByText('Diğer')).toBeInTheDocument();
    expect(screen.queryByText('Kapı açık')).not.toBeInTheDocument();
    await waitFor(() => expect(api.markNotesSeen).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(localStorage.getItem('noteDeckPendingViews')).toBeNull());
  });

  it('asistanda deste boşken "Hepsini gördün" satırı görünür', async () => {
    api.getNotes.mockResolvedValue([note({ id: '9', body: 'Eski', seen_by_me: true, author_name: 'Mert Aydın' })]);
    await renderHome(assistant);

    expect(await screen.findByText('Hepsini gördün')).toBeInTheDocument();
    expect(screen.getByText(/Son not: Mert Aydın/)).toBeInTheDocument();
    expect(screen.queryByText('Siparişler')).not.toBeInTheDocument();
  });
});
