import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventDetail } from '../mobile/events/MobileEventDetail';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(), getEventParticipants: vi.fn(), getNotes: vi.fn(),
  markEventParticipantContacted: vi.fn(), removeEventParticipant: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.getEventById.mockResolvedValue({ name: 'Pamucak', starts_at: '2026-09-20T09:00:00+03:00' });
  api.getNotes.mockResolvedValue([]);
});

async function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MobileEventDetail eventId="10" /></QueryClientProvider>);
  const rows = await screen.findAllByRole('button', { name: /detayını aç$/ });
  return rows.map((r) => r.getAttribute('aria-label').replace(' detayını aç', ''));
}

describe('Etkinlik katılımcı listesinde misafir sıralaması', () => {
  it('alfabetik olarak host\'undan önce gelen misafiri host\'un hemen ardına taşır', async () => {
    api.getEventParticipants.mockResolvedValue([
      { id: '1', student_name: 'gfgdfg', role: 'regular', rsvp_status: 'coming', guest_of_participant_id: '2', total_due: '1700', total_paid: '0' },
      { id: '2', student_name: 'sdf', role: 'regular', rsvp_status: 'coming', total_due: '1700', total_paid: '0' },
      { id: '3', student_name: 'sdfdsf', role: 'regular', rsvp_status: 'coming', total_due: '1700', total_paid: '0' },
      { id: '4', student_name: 'test', role: 'regular', rsvp_status: 'coming', total_due: '1700', total_paid: '0' },
    ]);
    expect(await renderList()).toEqual(['sdf', 'gfgdfg', 'sdfdsf', 'test']);
  });

  it('"Tümü" görünümünde host farklı bir RSVP durumunda olsa da misafiri host\'un ardına taşır', async () => {
    api.getEventParticipants.mockResolvedValue([
      { id: '1', student_name: 'ayşe', role: 'regular', rsvp_status: 'coming', guest_of_participant_id: '2', total_due: '0', total_paid: '0' },
      { id: '2', student_name: 'burak', role: 'regular', rsvp_status: 'unsure', total_due: '0', total_paid: '0' },
    ]);
    expect(await renderList()).toEqual(['burak', 'ayşe']);
  });

  it('"Geliyor"/"Belirsiz" filtresinde misafirleri normal öğrenci gibi düz sırada gösterir', async () => {
    api.getEventParticipants.mockResolvedValue([
      { id: '1', student_name: 'ayşe', role: 'regular', rsvp_status: 'coming', guest_of_participant_id: '2', total_due: '0', total_paid: '0' },
      { id: '2', student_name: 'burak', role: 'regular', rsvp_status: 'coming', total_due: '0', total_paid: '0' },
    ]);
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Geliyor' }));
    const row = await screen.findByRole('button', { name: 'ayşe detayını aç' });
    expect(within(row).queryByText(/misafiri/)).not.toBeInTheDocument();
  });

  it('ücret yerine gelme durumunu sağda gösterir', async () => {
    api.getEventParticipants.mockResolvedValue([
      { id: '1', student_name: 'Ayşe', role: 'regular', rsvp_status: 'coming', total_due: '1700', total_paid: '500' },
    ]);
    await renderList();
    const row = screen.getByRole('button', { name: 'Ayşe detayını aç' });
    expect(within(row).getByText('Geliyor')).toBeInTheDocument();
    expect(within(row).queryByText(/1\.200/)).not.toBeInTheDocument();
  });

  it('öğrencinin adını ve lakabını normal öğrenci listesindeki biçimle gösterir', async () => {
    api.getEventParticipants.mockResolvedValue([
      {
        id: '1', student_name: 'Cansu', student_nickname: 'Polonya', role: 'regular',
        rsvp_status: 'unsure', total_due: '0', total_paid: '0',
      },
    ]);
    await renderList();
    const row = screen.getByRole('button', { name: 'Cansu "Polonya" detayını aç' });
    expect(within(row).getByText('"Polonya"')).toHaveClass('mobile-tri-row-nick');
    expect(row.querySelector('.evx-participant-name')).toHaveTextContent('Cansu"Polonya"');
    expect(within(row).queryByText('Cansu', { selector: '.evx-row-sub' })).not.toBeInTheDocument();
  });

  it('yeni öğrenciyi ve toplam aranma sayısını kartta gösterir', async () => {
    api.getEventParticipants.mockResolvedValue([
      {
        id: '1', student_name: 'Ayşe', role: 'regular', rsvp_status: 'unsure',
        total_due: '1700', total_paid: '0', is_new_student: true,
        last_contacted_at: '2026-09-06T11:30:00.000Z', contact_count: 3,
      },
    ]);
    await renderList();
    const row = screen.getByRole('button', { name: 'Ayşe detayını aç' });
    expect(screen.getByText('YENİ')).toBeInTheDocument();
    expect(screen.getByLabelText('3 kez arandı')).toHaveTextContent('ARANDI· 3');
    expect(within(row).getByText('Belirsiz')).toBeInTheDocument();
  });

  it('katılımcı API hatasını boş liste gibi göstermez ve yeniden dener', async () => {
    api.getEventById.mockResolvedValue({
      name: 'Pamucak', starts_at: '2026-09-20T09:00:00+03:00',
      coming: 3, unsure: 1, totalParticipants: 4,
    });
    api.getEventParticipants
      .mockRejectedValueOnce(new Error('Katılımcı listesi alınamadı.'))
      .mockResolvedValueOnce([
        { id: '1', student_name: 'Ayşe', role: 'regular', rsvp_status: 'coming', total_due: '0', total_paid: '0' },
      ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MobileEventDetail eventId="10" /></QueryClientProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Katılımcılar gösterilemiyor');
    expect(screen.getByText('4 öğrenciden')).toBeInTheDocument();
    expect(screen.queryByText('Kimse yok')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByRole('button', { name: 'Ayşe detayını aç' })).toBeInTheDocument();
  });
});
