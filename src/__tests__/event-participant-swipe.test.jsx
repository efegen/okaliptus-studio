import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventDetail } from '../mobile/events/MobileEventDetail';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(), getEventParticipants: vi.fn(), getNotes: vi.fn(), removeEventParticipant: vi.fn(),
}));

let participants;
beforeEach(() => {
  vi.clearAllMocks();
  // jsdom'da PointerEvent yok; koordinatlar ve pointer kimliğini koru.
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  });
  participants = ['Ayşe', 'Deniz'].map((name, index) => ({
    id: String(index + 1), student_name: name, role: 'regular', rsvp_status: 'coming',
    total_due: '0', total_paid: '0',
  }));
  api.getEventById.mockResolvedValue({ name: 'Pamucak', starts_at: '2026-09-13T09:00:00+03:00' });
  api.getEventParticipants.mockImplementation(async () => [...participants]);
  api.getNotes.mockResolvedValue([]);
  api.removeEventParticipant.mockImplementation(async (id) => { participants = participants.filter((p) => p.id !== id); });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MobileEventDetail eventId="10" onOpenParticipant={onOpen} /></QueryClientProvider>);
  const row = await screen.findByRole('button', { name: 'Ayşe detayını aç' });
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ width: 330 });
  return { row, onOpen };
}

function swipe(row, dx, dy = 0, cancelled = false) {
  fireEvent.pointerDown(row, { pointerId: 1, clientX: 300, clientY: 100, button: 0 });
  fireEvent.pointerMove(row, { pointerId: 1, clientX: 300 + dx, clientY: 100 + dy });
  if (cancelled) fireEvent.pointerCancel(row, { pointerId: 1 });
  else fireEvent.pointerUp(row, { pointerId: 1, clientX: 300 + dx, clientY: 100 + dy });
  // Tarayıcının hareketin ardından üretebildiği click, profili açmamalı.
  fireEvent.click(row);
}

describe('Etkinlik katılımcısını sola kaydırarak kaldırma', () => {
  it('normal dokunuş detay açar; kısa kaydırma kaldırma alanını gösterir', async () => {
    const { row, onOpen } = await setup();
    expect(screen.queryByRole('button', { name: 'Ayşe etkinlikten kaldır' })).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    swipe(row, -90);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ayşe etkinlikten kaldır' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ayşe detayını aç' })).not.toBeInTheDocument());
    expect(api.removeEventParticipant).toHaveBeenCalledTimes(1);
    expect(api.removeEventParticipant).toHaveBeenCalledWith('1');
  });

  it('uzun kaydırma düğmeye basmadan kaldırma onayı açar; iptal satırı korur', async () => {
    window.confirm.mockReturnValue(false);
    const { row, onOpen } = await setup();
    swipe(row, -250);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(api.removeEventParticipant).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(row).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Ayşe etkinlikten kaldır' })).not.toBeInTheDocument();
  });

  it('uzun kaydırma onaylanınca yalnız etkinlik katılımcısını kaldırır', async () => {
    const { row, onOpen } = await setup();
    swipe(row, -250);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ayşe detayını aç' })).not.toBeInTheDocument());
    expect(api.removeEventParticipant).toHaveBeenCalledTimes(1);
    expect(api.removeEventParticipant).toHaveBeenCalledWith('1');
    expect(screen.getByRole('button', { name: 'Deniz detayını aç' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('dikey, sağa veya iptal edilmiş hareket kaldırmayı tetiklemez', async () => {
    const { row, onOpen } = await setup();
    swipe(row, -20, 180);
    swipe(row, 150);
    swipe(row, -250, 0, true);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Ayşe etkinlikten kaldır' })).not.toBeInTheDocument();
  });

  it('sağa kaydırma ve dışarı dokunma açık aksiyonu kapatır; klavye ile de erişilir', async () => {
    const { row } = await setup();
    swipe(row, -90);
    swipe(row, 90);
    expect(screen.queryByRole('button', { name: 'Ayşe etkinlikten kaldır' })).not.toBeInTheDocument();
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'Ayşe etkinlikten kaldır' })).toBeEnabled();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Deniz detayını aç' }), { button: 0 });
    expect(screen.queryByRole('button', { name: 'Ayşe etkinlikten kaldır' })).not.toBeInTheDocument();
    fireEvent.keyDown(row, { key: 'Delete' });
    await waitFor(() => expect(api.removeEventParticipant).toHaveBeenCalledWith('1'));
  });

  it('backend kaldırmayı reddederse hata gösterir ve satır kullanılabilir kalır', async () => {
    api.removeEventParticipant.mockRejectedValue(new Error('Ödemesi alınmış katılımcı kaldırılamaz.'));
    const { row } = await setup();
    swipe(row, -250);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Ödemesi alınmış katılımcı kaldırılamaz.'));
    expect(row).toBeEnabled();
    expect(row).toBeInTheDocument();
  });
});
