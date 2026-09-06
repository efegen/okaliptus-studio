import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventAddPerson } from '../mobile/events/MobileEventAddPerson';
import * as api from '../api';

vi.mock('../api', () => ({
  searchEventStudents: vi.fn(),
  addEventParticipant: vi.fn(),
  updateEventParticipant: vi.fn(),
  getEventById: vi.fn(),
  getEventParticipants: vi.fn(),
}));

function renderAddGuest(participants) {
  api.getEventParticipants.mockResolvedValue(participants);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onAdded = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MobileEventAddPerson
        eventId="1"
        presetGuestOf={{ participantId: '10', label: 'Ayşe' }}
        onClose={vi.fn()}
        onAdded={onAdded}
      />
    </QueryClientProvider>,
  );
  return onAdded;
}

async function searchFor(name) {
  fireEvent.change(screen.getByPlaceholderText('İsim veya telefon'), { target: { value: name } });
  return screen.findByText(name);
}

describe('Etkinlikteki kişiyi misafir olarak bağlama', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getEventById.mockResolvedValue({ name: 'Etkinlik', feeItems: [] });
    api.updateEventParticipant.mockResolvedValue({});
  });

  it('bağı olmayan mevcut katılımcıyı yeni kayıt oluşturmadan misafir yapar', async () => {
    const participant = { id: '20', student_id: '2', student_name: 'Deniz', guest_of_participant_id: null };
    api.searchEventStudents.mockResolvedValue([
      { id: '2', full_name: 'Deniz', nickname: null, phone: null, already_in_event: true },
    ]);
    const onAdded = renderAddGuest([
      { id: '10', student_id: '1', student_name: 'Ayşe', guest_of_participant_id: null },
      participant,
    ]);

    await searchFor('Deniz');
    fireEvent.click(screen.getByRole('button', { name: /Deniz.*Ayşe misafiri olarak bağla/ }));

    await waitFor(() => expect(api.updateEventParticipant).toHaveBeenCalledWith('20', {
      guestOfParticipantId: '10',
    }));
    expect(api.addEventParticipant).not.toHaveBeenCalled();
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
  });

  it.each([
    {
      label: 'başka birine bağlıysa',
      participants: [
        { id: '10', student_id: '1', student_name: 'Ayşe', guest_of_participant_id: null },
        { id: '20', student_id: '2', student_name: 'Deniz', guest_of_participant_id: '30' },
      ],
    },
    {
      label: 'kendi misafiri varsa',
      participants: [
        { id: '10', student_id: '1', student_name: 'Ayşe', guest_of_participant_id: null },
        { id: '20', student_id: '2', student_name: 'Deniz', guest_of_participant_id: null },
        { id: '30', student_id: '3', student_name: 'Ece', guest_of_participant_id: '20' },
      ],
    },
  ])('$label bağlama eylemini göstermez', async ({ participants }) => {
    api.searchEventStudents.mockResolvedValue([
      { id: '2', full_name: 'Deniz', nickname: null, phone: null, already_in_event: true },
    ]);
    renderAddGuest(participants);

    await searchFor('Deniz');
    expect(screen.getByText('Zaten listede')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deniz.*misafiri olarak bağla/ })).not.toBeInTheDocument();
    expect(api.updateEventParticipant).not.toHaveBeenCalled();
  });
});
