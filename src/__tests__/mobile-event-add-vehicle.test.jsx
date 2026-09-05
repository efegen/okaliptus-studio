import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventAddVehicle } from '../mobile/events/MobileEventAddVehicle';
import * as api from '../api';

vi.mock('../api', () => ({
  searchEventStudents: vi.fn(),
  getEventParticipants: vi.fn(),
  createEventVehicle: vi.fn(),
  addEventParticipant: vi.fn(),
  assignEventParticipantVehicle: vi.fn(),
}));

let participants;

function renderAddVehicle() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onBack = vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <MobileEventAddVehicle eventId="1" onBack={onBack} />
    </QueryClientProvider>,
  );
  return { ...result, onBack };
}

describe('Mobil yeni araç ekranı', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    participants = [
      { id: '2', student_id: '12', student_name: 'Elif', transport_mode: 'needs_vehicle', vehicle_id: null },
    ];
    api.getEventParticipants.mockImplementation(async () => participants.map((participant) => ({ ...participant })));
    api.searchEventStudents.mockImplementation(async (_eventId, query) => (
      query === 'Deniz'
        ? [{ id: '21', full_name: 'Deniz', nickname: null, phone: '05550000000' }]
        : []
    ));
    api.createEventVehicle.mockResolvedValue({ id: '30' });
    api.addEventParticipant.mockResolvedValue({ id: '99' });
    api.assignEventParticipantVehicle.mockResolvedValue({});
  });

  it('araç tipini ve saati kaldırır, koltuk alanını kompakt tutar ve etkinlikteki yolcuyu araçla birlikte ekler', async () => {
    const { container, onBack } = renderAddVehicle();

    expect(await screen.findByText('Yeni araç')).toBeInTheDocument();
    expect(screen.queryByText('Araç tipi')).not.toBeInTheDocument();
    expect(screen.queryByText('Kiralık · servis')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Yolcu koltuğu sayısı' })).toHaveTextContent('4');

    fireEvent.click(screen.getByRole('button', { name: /^Yolcu ekle/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Elif.*Araç bekliyor/ }));
    fireEvent.click(screen.getByRole('button', { name: '1 yolcuyu seç' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Şoför ara' }), { target: { value: 'Deniz' } });
    fireEvent.click(await screen.findByRole('button', { name: /Deniz.*05550000000.*Seç/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Aracı ve 1 yolcuyu ekle' }));

    await waitFor(() => expect(api.createEventVehicle).toHaveBeenCalledWith('1', {
      vehicleType: 'student_car',
      driverStudentId: '21',
      driverName: null,
      driverPhone: null,
      passengerSeats: 4,
      meetingTime: null,
      meetingPlace: null,
      note: null,
    }));
    expect(api.assignEventParticipantVehicle).toHaveBeenCalledWith('2', '30');
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  });

  it('listede olmayan bir yolcuyu yeni araç oluşturulurken ekler', async () => {
    participants = [];
    renderAddVehicle();

    fireEvent.click(await screen.findByRole('button', { name: /^Yolcu ekle/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Yolcu ara' }), { target: { value: 'Ece Kaya' } });
    fireEvent.click(await screen.findByRole('button', { name: /Ece Kaya.*dışarıdan kişiyi ekle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Listeye ekle' }));
    fireEvent.click(screen.getByRole('button', { name: '1 yolcuyu seç' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Şoför ara' }), { target: { value: 'Mert' } });
    fireEvent.click(await screen.findByRole('button', { name: /Mert.*dışarıdan şoför/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Aracı ve 1 yolcuyu ekle' }));

    await waitFor(() => expect(api.addEventParticipant).toHaveBeenCalledWith('1', {
      fullName: 'Ece Kaya',
      phone: null,
      role: 'regular',
      rsvpStatus: 'coming',
      transportMode: 'needs_vehicle',
    }));
    expect(api.assignEventParticipantVehicle).toHaveBeenCalledWith('99', '30');
  });
});
