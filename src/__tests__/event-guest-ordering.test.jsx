import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventDetail } from '../mobile/events/MobileEventDetail';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(), getEventParticipants: vi.fn(), getNotes: vi.fn(), removeEventParticipant: vi.fn(),
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

  it('host farklı bir RSVP durumundaysa misafiri kendi sırasında bırakır', async () => {
    api.getEventParticipants.mockResolvedValue([
      { id: '1', student_name: 'ayşe', role: 'regular', rsvp_status: 'coming', guest_of_participant_id: '2', total_due: '0', total_paid: '0' },
      { id: '2', student_name: 'burak', role: 'regular', rsvp_status: 'unsure', total_due: '0', total_paid: '0' },
    ]);
    expect(await renderList()).toEqual(['ayşe', 'burak']);
  });
});
