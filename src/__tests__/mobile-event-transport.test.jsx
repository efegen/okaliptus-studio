import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventTransport } from '../mobile/events/MobileEventTransport';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(),
  getEventParticipants: vi.fn(),
  getEventVehicles: vi.fn(),
  searchEventStudents: vi.fn(),
  addEventParticipant: vi.fn(),
  assignEventParticipantVehicle: vi.fn(),
  updateEventParticipant: vi.fn(),
  updateEventVehicle: vi.fn(),
  deleteEventVehicle: vi.fn(),
}));

let participants;
let vehicles;

function renderTransport(props = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenAddVehicle = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MobileEventTransport
        eventId="1"
        onBack={() => {}}
        onOpenAddVehicle={onOpenAddVehicle}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenAddVehicle };
}

describe('Mobil etkinlik ulaşım planı', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    participants = [
      { id: '1', student_id: '11', student_name: 'Ayşe', transport_mode: 'needs_vehicle', vehicle_id: '10' },
      { id: '2', student_id: '12', student_name: 'Elif', transport_mode: 'needs_vehicle', vehicle_id: null },
      { id: '3', student_id: '13', student_name: 'Selin', transport_mode: 'self_arranged', vehicle_id: null },
      { id: '4', student_id: '14', student_name: 'Can', transport_mode: 'unspecified', vehicle_id: null },
    ];
    vehicles = [
      {
        id: '10', driver_name: 'Deniz', driver_student_id: null, vehicle_type: 'student_car',
        passenger_seats: 3, seats_taken: 1, meeting_time: '2026-09-06T06:00:00.000Z', meeting_place: 'Stüdyo',
      },
      {
        id: '20', driver_name: 'Mert', driver_student_id: null, vehicle_type: 'rental_service',
        passenger_seats: 2, seats_taken: 2, meeting_time: null, meeting_place: null,
      },
    ];

    api.getEventById.mockResolvedValue({ id: '1', name: 'Pamucak Buluşması' });
    api.getEventParticipants.mockImplementation(async () => participants.map((participant) => ({ ...participant })));
    api.getEventVehicles.mockImplementation(async () => vehicles.map((vehicle) => ({ ...vehicle })));
    api.searchEventStudents.mockResolvedValue([]);
    api.addEventParticipant.mockImplementation(async (_eventId, input) => {
      const participant = {
        id: String(100 + participants.length),
        student_id: input.studentId || String(200 + participants.length),
        student_name: input.fullName || 'Yeni öğrenci',
        transport_mode: input.transportMode,
        vehicle_id: null,
      };
      participants.push(participant);
      return { ...participant };
    });
    api.assignEventParticipantVehicle.mockImplementation(async (participantId, vehicleId) => {
      const participant = participants.find((item) => item.id === participantId);
      const previousVehicle = vehicles.find((vehicle) => vehicle.id === participant.vehicle_id);
      if (previousVehicle) previousVehicle.seats_taken -= 1;
      participant.vehicle_id = vehicleId;
      participant.transport_mode = 'needs_vehicle';
      vehicles.find((vehicle) => vehicle.id === vehicleId).seats_taken += 1;
    });
    api.updateEventParticipant.mockImplementation(async (participantId, input) => {
      const participant = participants.find((item) => item.id === participantId);
      participant.transport_mode = input.transportMode;
      participant.vehicle_id = null;
    });
  });

  it('gereksiz plan KPI alanını göstermez ve bekleyen kişiyi araç seçme sheetinden yerleştirir', async () => {
    renderTransport();

    expect(await screen.findByText('Araç bekleyenler')).toBeInTheDocument();
    expect(screen.queryByText('Plan durumu')).not.toBeInTheDocument();
    expect(screen.getByText('Pamucak Buluşması')).toBeInTheDocument();
    expect(screen.getAllByText('2 boş').length).toBeGreaterThan(0);
    expect(screen.getByText('Stüdyo')).toBeInTheDocument();
    const denizVehicle = screen.getByRole('article', { name: 'Deniz' });
    const seatDots = within(denizVehicle).getByRole('img', { name: 'Deniz aracında 1 dolu, 2 boş yolcu koltuğu' });
    expect(seatDots.children).toHaveLength(3);
    expect(seatDots.querySelectorAll('.is-filled')).toHaveLength(1);
    expect(within(denizVehicle).getByText('Şoför')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Elif.*Araç seç/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Elif için araç seç')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mert.*Dolu/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Deniz.*2 boş/ }));
    await waitFor(() => expect(api.assignEventParticipantVehicle).toHaveBeenCalledWith('2', '10'));
    expect(await screen.findByText('Elif araca yerleştirildi.')).toBeInTheDocument();
    expect(screen.queryByText('Elif için araç seç')).not.toBeInTheDocument();
  });

  it('araç yokken bekleyeni çıkmazda bırakmaz ve ekleme eylemini gösterir', async () => {
    vehicles = [];
    participants = [
      { id: '2', student_id: '12', student_name: 'Elif', transport_mode: 'needs_vehicle', vehicle_id: null },
    ];
    const { onOpenAddVehicle } = renderTransport();

    expect(await screen.findByText('Henüz araç eklenmedi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Araç ekle' }));
    expect(onOpenAddVehicle).toHaveBeenCalledTimes(1);
  });

  it('atanmış yolcuyu bağlamını kaybetmeden başka araca taşıtır ve hatayı sheet içinde gösterir', async () => {
    vehicles[1].seats_taken = 1;
    api.assignEventParticipantVehicle.mockRejectedValueOnce(new Error('Araç artık dolu.'));
    renderTransport();

    fireEvent.click(await screen.findByRole('button', { name: 'Ayşe için aracı değiştir' }));
    expect(screen.getByRole('button', { name: /Deniz.*Mevcut/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Mert.*1 boş/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Araç artık dolu.');
    expect(screen.getByText('Ayşe için araç seç')).toBeInTheDocument();
  });

  it('atanmış yolcuyu araçtan çıkarıp kendi geliyor olarak işaretler', async () => {
    renderTransport();
    fireEvent.click(await screen.findByRole('button', { name: 'Ayşe için aracı değiştir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kendi geliyor' }));
    await waitFor(() => expect(api.updateEventParticipant).toHaveBeenCalledWith('1', { transportMode: 'self_arranged' }));
    expect(await screen.findByText('Ayşe ulaşım durumu güncellendi.')).toBeInTheDocument();
  });

  it('paylaşım metnine buluşma ve çözülmemiş grupları dahil eder', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    renderTransport();

    fireEvent.click(await screen.findByRole('button', { name: 'Ulaşım planını paylaş' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0][0];
    expect(payload.text).toContain('Buluşma: Stüdyo');
    expect(payload.text).toContain('Araç bekleyenler: Elif');
    expect(payload.text).toContain('Kendi gelenler: Selin');
    expect(payload.text).toContain('Ulaşımı seçilmemiş: Can');
  });

  it('boş araç kartından etkinlikteki bir yolcuyu doğrudan ekler', async () => {
    participants = [
      { id: '2', student_id: '12', student_name: 'Elif', transport_mode: 'needs_vehicle', vehicle_id: null },
    ];
    vehicles = [{
      id: '10', driver_name: 'Deniz', driver_student_id: null, vehicle_type: 'student_car',
      passenger_seats: 3, seats_taken: 0, meeting_time: null, meeting_place: null,
    }];
    renderTransport();

    fireEvent.click(await screen.findByRole('button', { name: /^Yolcu ekle/ }));
    expect(await screen.findByText('Deniz aracına yolcu ekle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Elif.*Araç bekliyor/ }));
    fireEvent.click(screen.getByRole('button', { name: '1 yolcuyu seç' }));

    await waitFor(() => expect(api.assignEventParticipantVehicle).toHaveBeenCalledWith('2', '10'));
    expect(await screen.findByText('1 yolcu araca eklendi.')).toBeInTheDocument();
  });

  it('boş araç kartından listede olmayan bir kişiyi oluşturup araca ekler', async () => {
    participants = [];
    vehicles = [{
      id: '10', driver_name: 'Deniz', driver_student_id: null, vehicle_type: 'student_car',
      passenger_seats: 3, seats_taken: 0, meeting_time: null, meeting_place: null,
    }];
    renderTransport();

    fireEvent.click(await screen.findByRole('button', { name: /^Yolcu ekle/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Yolcu ara' }), { target: { value: 'Ece Kaya' } });
    fireEvent.click(await screen.findByRole('button', { name: /Ece Kaya.*dışarıdan kişiyi ekle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Listeye ekle' }));
    fireEvent.click(screen.getByRole('button', { name: '1 yolcuyu seç' }));

    await waitFor(() => expect(api.addEventParticipant).toHaveBeenCalledWith('1', expect.objectContaining({
      fullName: 'Ece Kaya',
      rsvpStatus: 'coming',
      transportMode: 'needs_vehicle',
    })));
    expect(api.assignEventParticipantVehicle).toHaveBeenCalledWith('100', '10');
  });

  it('kayıtlı araç sahibini araçtakilerde şoför olarak gösterir ve bekleyenlerden çıkarır', async () => {
    participants = [
      { id: '5', student_id: '15', student_name: 'Deniz', transport_mode: 'needs_vehicle', vehicle_id: null },
      { id: '2', student_id: '12', student_name: 'Elif', transport_mode: 'needs_vehicle', vehicle_id: null },
    ];
    vehicles = [{
      id: '10', driver_name: null, driver_student_id: '15', vehicle_type: 'student_car',
      passenger_seats: 3, seats_taken: 0, meeting_time: null, meeting_place: null,
    }];
    renderTransport();

    const waitingSection = await screen.findByRole('region', { name: 'Araç bekleyenler' });
    expect(within(waitingSection).getByText('Elif')).toBeInTheDocument();
    expect(within(waitingSection).queryByText('Deniz')).not.toBeInTheDocument();

    const vehicleCard = screen.getByRole('article', { name: 'Deniz' });
    expect(within(vehicleCard).getByText('Şoför')).toBeInTheDocument();
    expect(within(vehicleCard).getByRole('img', { name: 'Deniz aracında 0 dolu, 3 boş yolcu koltuğu' })).toBeInTheDocument();
  });
});
