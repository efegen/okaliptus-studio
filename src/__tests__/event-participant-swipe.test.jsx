import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventDetail } from '../mobile/events/MobileEventDetail';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(),
  getEventParticipants: vi.fn(),
  getNotes: vi.fn(),
  markEventParticipantContacted: vi.fn(),
  removeEventParticipant: vi.fn(),
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
    id: String(index + 1), student_name: name, student_phone: index === 0 ? '0555 111 22 33' : null,
    role: 'regular', rsvp_status: 'coming', total_due: '0', total_paid: '0',
  }));
  api.getEventById.mockResolvedValue({ name: 'Pamucak', starts_at: '2026-09-13T09:00:00+03:00' });
  api.getEventParticipants.mockImplementation(async () => [...participants]);
  api.getNotes.mockResolvedValue([]);
  api.removeEventParticipant.mockImplementation(async (id) => {
    participants = participants.filter((participant) => participant.id !== id);
  });
  api.markEventParticipantContacted.mockImplementation(async (id, input) => {
    participants = participants.map((participant) => participant.id === id
      ? {
          ...participant,
          last_contacted_at: '2026-09-06T11:30:00.000Z',
          contact_note: input.note,
          contact_count: Number(participant.contact_count || 0) + 1,
        }
      : participant);
    return participants.find((participant) => participant.id === id);
  });
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

describe('Etkinlik katılımcısı kaydırma aksiyonları', () => {
  it('normal dokunuş detay açar; kısa sola kaydırma kaldırma alanını gösterir', async () => {
    const { row, onOpen } = await setup();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);

    swipe(row, -90);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ayşe etkinlikten kaldır' }));

    expect(screen.getByText('Ayşe kaldırılsın mı?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listeden kaldır' })).toBeDisabled();
    expect(api.removeEventParticipant).not.toHaveBeenCalled();
  });

  it('kaldırma nedenini ve notunu kaydeder, sonra yalnız seçilen satırı kaldırır', async () => {
    const { row, onOpen } = await setup();
    swipe(row, -250);
    fireEvent.click(screen.getByRole('button', { name: 'Öğrenci iptal etti' }));
    fireEvent.change(screen.getByLabelText(/Kaldırma notu/), { target: { value: 'Ailesiyle programı çakıştı.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Listeden kaldır' }));

    await waitFor(() => expect(api.removeEventParticipant).toHaveBeenCalledWith('1', {
      reason: 'student_cancelled',
      note: 'Ailesiyle programı çakıştı.',
    }));
    await waitFor(() => expect(screen.queryByLabelText('Ayşe detayını aç')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Deniz detayını aç')).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('kaldırma penceresinden vazgeçince satırı korur', async () => {
    const { row } = await setup();
    swipe(row, -250);
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));

    await waitFor(() => expect(screen.queryByText('Ayşe kaldırılsın mı?')).not.toBeInTheDocument());
    expect(api.removeEventParticipant).not.toHaveBeenCalled();
    expect(row).toBeInTheDocument();
  });

  it('sağa kaydırınca telefon kısayoluyla arama notunu kaydeder ve satırı işaretler', async () => {
    const { row } = await setup();
    swipe(row, 90);
    fireEvent.click(screen.getByRole('button', { name: 'Ayşe arandı olarak işaretle' }));

    expect(screen.getByRole('link', { name: /Şimdi ara/ })).toHaveAttribute('href', 'tel:05551112233');
    fireEvent.change(screen.getByLabelText(/Arama notu/), { target: { value: 'Ulaşılamadı, yarın tekrar.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Arandı olarak kaydet' }));

    await waitFor(() => expect(api.markEventParticipantContacted).toHaveBeenCalledWith('1', {
      note: 'Ulaşılamadı, yarın tekrar.',
    }));
    expect(await screen.findByLabelText('1 kez arandı')).toHaveTextContent('ARANDI· 1');
  });

  it('telefonu olmayan kişide bilgi verir; uzun sağa kaydırma pencereyi doğrudan açar', async () => {
    await setup();
    const deniz = screen.getByRole('button', { name: 'Deniz detayını aç' });
    vi.spyOn(deniz, 'getBoundingClientRect').mockReturnValue({ width: 330 });
    swipe(deniz, 250);
    expect(screen.getByText('Telefon numarası kayıtlı değil')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Şimdi ara/ })).not.toBeInTheDocument();
  });

  it('dikey veya iptal edilmiş hareket aksiyon tetiklemez', async () => {
    const { row, onOpen } = await setup();
    swipe(row, -20, 180);
    swipe(row, -250, 0, true);
    expect(api.removeEventParticipant).not.toHaveBeenCalled();
    expect(api.markEventParticipantContacted).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText('Ayşe kaldırılsın mı?')).not.toBeInTheDocument();
  });

  it('klavye ile iki aksiyonu da açar ve Escape ile kapatır', async () => {
    const { row } = await setup();
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'Ayşe etkinlikten kaldır' })).toBeEnabled();
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Ayşe etkinlikten kaldır' })).not.toBeInTheDocument();
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Ayşe arandı olarak işaretle' })).toBeEnabled();
  });

  it('backend kaldırmayı reddederse hatayı pencerede gösterir ve satırı korur', async () => {
    api.removeEventParticipant.mockRejectedValue(new Error('Ödemesi alınmış katılımcı kaldırılamaz.'));
    const { row } = await setup();
    swipe(row, -250);
    fireEvent.click(screen.getByRole('button', { name: 'Diğer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Listeden kaldır' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ödemesi alınmış katılımcı kaldırılamaz.');
    expect(row).toBeInTheDocument();
  });
});
