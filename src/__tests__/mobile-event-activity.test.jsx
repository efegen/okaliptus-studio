import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventDetail } from '../mobile/events/MobileEventDetail';
import { MobileEventActivity } from '../mobile/events/MobileEventActivity';
import { CurrentUserProvider } from '../currentUser';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(), getEventParticipants: vi.fn(), getNotes: vi.fn(),
  markEventParticipantContacted: vi.fn(), removeEventParticipant: vi.fn(),
  getEventActivity: vi.fn(), revertEventActivity: vi.fn(),
}));

const EVENT = { id: '10', name: 'Pamucak', starts_at: '2026-09-20T09:00:00+03:00' };

beforeEach(() => {
  vi.clearAllMocks();
  api.getEventById.mockResolvedValue(EVENT);
  api.getEventParticipants.mockResolvedValue([]);
  api.getNotes.mockResolvedValue([]);
  api.getEventActivity.mockResolvedValue([]);
});

function renderWith(ui, role = 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <CurrentUserProvider user={{ id: '1', displayName: 'Efe', role }}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </CurrentUserProvider>,
  );
}

function activityRow(overrides = {}) {
  return {
    id: '77',
    event_id: '10',
    action: 'event_participant_payment_recorded',
    entity_type: 'event_payment',
    entity_id: '900',
    before: null,
    after: { participantId: '5', amount: '500.00', source: 'cash' },
    note: null,
    created_at: '2026-09-06T11:30:00.000Z',
    actor_user_id: '2',
    actor_name: 'Ayşe Yılmaz',
    reverted_at: null,
    reverted_by_name: null,
    subject_name: 'Deniz Kaya',
    subject_nickname: null,
    participant_id: '5',
    vehicle_label: null,
    revertable: true,
    revert_blocked_reason: null,
    ...overrides,
  };
}

describe('Etkinlik hareketleri kısayolu', () => {
  it('Notlar ile Finans arasında yer alır ve diğer kısayolları daraltmaz', async () => {
    const onOpenActivity = vi.fn();
    renderWith(<MobileEventDetail eventId="10" onOpenActivity={onOpenActivity} />);

    const activityChip = await screen.findByRole('button', { name: /Hareketler/ });
    const chipRow = activityChip.parentElement;
    // Sıra: Notlar · Hareketler · Finans · Ayarlar (Ulaşım kapalı).
    const titles = Array.from(chipRow.querySelectorAll('.evx-chip-title')).map((n) => n.textContent);
    expect(titles).toEqual(['Notlar', 'Hareketler', 'Finans', 'Ayarlar']);
    // Çip satırı daima "is-overflowing": kısayollar sabit genişlikte kalır.
    expect(chipRow.className).toContain('is-overflowing');

    fireEvent.click(activityChip);
    expect(onOpenActivity).toHaveBeenCalled();
  });

  it('asistan rolüne gösterilmez', async () => {
    renderWith(<MobileEventDetail eventId="10" />, 'assistant');
    await screen.findByRole('button', { name: /Notlar/ });
    expect(screen.queryByRole('button', { name: /Hareketler/ })).not.toBeInTheDocument();
  });
});

describe('Etkinlik hareketleri ekranı', () => {
  it('işlemi yapan kullanıcının adıyla birlikte okunur bir özet gösterir', async () => {
    api.getEventActivity.mockResolvedValue([
      activityRow(),
      activityRow({
        id: '76', action: 'event_participant_removed', entity_type: 'event_participant',
        entity_id: '6', participant_id: null,
        before: { student_id: '9', role: 'regular', rsvp_status: 'coming', removalReason: 'plans_changed' },
        after: null, subject_name: 'Mert Su', actor_name: 'Efe Gen',
      }),
    ]);
    renderWith(<MobileEventActivity eventId="10" />);

    expect(await screen.findByText('Deniz Kaya · 500 ₺ tahsil edildi')).toBeInTheDocument();
    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('Mert Su listeden kaldırıldı')).toBeInTheDocument();
    expect(screen.getByText('Efe Gen')).toBeInTheDocument();
  });

  it('hatalı işlemi geri alır ve kaydı "geri alındı" olarak tazeler', async () => {
    api.getEventActivity.mockResolvedValueOnce([activityRow()]);
    api.revertEventActivity.mockResolvedValue({
      ...activityRow(), reverted_at: '2026-09-06T12:00:00.000Z',
      reverted_by_name: 'Efe', revertable: false,
    });
    api.getEventActivity.mockResolvedValue([
      activityRow({ reverted_at: '2026-09-06T12:00:00.000Z', reverted_by_name: 'Efe', revertable: false }),
    ]);

    renderWith(<MobileEventActivity eventId="10" />);
    fireEvent.click(await screen.findByText('Deniz Kaya · 500 ₺ tahsil edildi'));

    const undo = await screen.findByRole('button', { name: /Geri al/ });
    fireEvent.click(undo);

    await waitFor(() => expect(api.revertEventActivity).toHaveBeenCalledWith('10', '77'));
    expect(await screen.findByText('GERİ ALINDI')).toBeInTheDocument();
  });

  it('geri alınamayan harekette nedeni gösterir ve düğmeyi kilitler', async () => {
    api.getEventActivity.mockResolvedValue([
      activityRow({
        action: 'event_participant_payment_cancelled', revertable: false,
        before: { amount: '500.00' }, after: null,
        revert_blocked_reason: 'Tahsilat iptali geri alınamaz; para gerçekten alındıysa tahsilatı yeniden kaydedin.',
      }),
    ]);
    renderWith(<MobileEventActivity eventId="10" />);

    fireEvent.click(await screen.findByText('Deniz Kaya · 500 ₺ tahsilat iptal edildi'));
    expect(await screen.findByText(/Tahsilat iptali geri alınamaz/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Geri al/ })).toBeDisabled();
    expect(api.revertEventActivity).not.toHaveBeenCalled();
  });

  it('hâlâ listede olan kişiye "Kişiyi aç" ile düzeltme için gider', async () => {
    const onOpenParticipant = vi.fn();
    api.getEventActivity.mockResolvedValue([activityRow()]);
    renderWith(<MobileEventActivity eventId="10" onOpenParticipant={onOpenParticipant} />);

    fireEvent.click(await screen.findByText('Deniz Kaya · 500 ₺ tahsil edildi'));
    fireEvent.click(await screen.findByRole('button', { name: 'Kişiyi aç' }));
    expect(onOpenParticipant).toHaveBeenCalledWith('5');
  });

  it('katılımcı güncellemesini eski → yeni değer olarak açıklar', async () => {
    api.getEventActivity.mockResolvedValue([
      activityRow({
        action: 'event_participant_updated', entity_type: 'event_participant', entity_id: '5',
        before: { rsvpStatus: 'unsure' }, after: { rsvpStatus: 'coming' },
      }),
    ]);
    renderWith(<MobileEventActivity eventId="10" />);

    fireEvent.click(await screen.findByText('Deniz Kaya güncellendi'));
    const sheet = await screen.findByText(/Durum: Belirsiz → Geliyor/);
    expect(sheet).toBeInTheDocument();
  });

  it('hiç hareket yoksa boş durumu gösterir', async () => {
    renderWith(<MobileEventActivity eventId="10" />);
    expect(await screen.findByText('Henüz hareket yok')).toBeInTheDocument();
  });

  it('hata durumunda listeyi boş göstermez, yeniden denemeyi önerir', async () => {
    api.getEventActivity.mockRejectedValueOnce(new Error('Hareket listesi alınamadı.'));
    api.getEventActivity.mockResolvedValue([activityRow()]);
    renderWith(<MobileEventActivity eventId="10" />);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Hareketler gösterilemiyor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByText('Deniz Kaya · 500 ₺ tahsil edildi')).toBeInTheDocument();
  });
});
