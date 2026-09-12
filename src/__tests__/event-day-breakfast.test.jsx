import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventDayBreakfast } from '../mobile/events/MobileEventDayBreakfast';
import * as api from '../api';

// Kahvaltı listesi sayfası (bkz. MobileEventDay.jsx'teki Kahvaltı kartı,
// migration 0286): derse gelip kahvaltı seçen katılımcılar + hiç derse
// katılmayan "sadece kahvaltı" misafirlerini (breakfast_only) birleştirir.

vi.mock('../api', () => ({
  getEventDay: vi.fn(),
  createEventDayEntry: vi.fn(),
  updateEventDayEntry: vi.fn(),
  deleteEventDayEntry: vi.fn(),
  restoreEventDayEntry: vi.fn(),
}));

const PRICING = { lessonFee: '1050.00', breakfastFee: '650.00' };

function dayData(entries = []) {
  return {
    event: { id: '1', name: 'Bahçe yogası', starts_at: '2026-09-13T06:00:00Z', status: 'live', location: null },
    pricing: PRICING,
    summary: {
      people: entries.length,
      checked: 0,
      cash: '0.00',
      card: '0.00',
      iban: '0.00',
      total: '0.00',
      breakfastCount: entries.filter((e) => e.breakfast !== 'none').length,
      breakfastPaidToUs: entries.filter((e) => e.breakfast === 'paid_to_us').length,
      breakfastPaidToRestaurant: entries.filter((e) => e.breakfast === 'paid_to_restaurant').length,
      breakfastFree: entries.filter((e) => e.breakfast === 'free').length,
      breakfastCollected: '0.00',
      restaurantOwed: '0.00',
    },
    entries,
  };
}

function attendee(overrides = {}) {
  return {
    id: '1', event_id: '1', student_id: '5', full_name: 'Ayşe Yılmaz', nickname: null, phone: '5321234567',
    is_light: false, pre_registered: true, amount: '1700.00', payment_method: 'cash', breakfast: 'paid_to_us',
    breakfast_only: false, note: null, checked_at: null, checked_by_name: null,
    breakfast_confirmed_at: null, breakfast_confirmed_by_name: null,
    created_at: '2026-09-13T06:00:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    ...overrides,
  };
}

function guest(overrides = {}) {
  return {
    id: '2', event_id: '1', student_id: null, full_name: 'Kahvaltı Misafiri', nickname: null, phone: null,
    is_light: true, pre_registered: false, amount: '650.00', payment_method: 'cash', breakfast: 'paid_to_us',
    breakfast_only: true, note: null, checked_at: null, checked_by_name: null,
    breakfast_confirmed_at: null, breakfast_confirmed_by_name: null,
    created_at: '2026-09-13T06:01:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:01:00Z', updated_by_name: 'Efe',
    ...overrides,
  };
}

function renderPage(props = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MobileEventDayBreakfast eventId="1" onBack={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('MobileEventDayBreakfast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derse gelip kahvaltı seçenleri ve sadece-kahvaltı misafirlerini birlikte listeler', async () => {
    api.getEventDay.mockResolvedValue(dayData([attendee(), guest()]));
    renderPage();

    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('Kahvaltı Misafiri')).toBeInTheDocument();
    // Yalnız misafir satırı "MİSAFİR" rozeti taşır.
    const rows = screen.getAllByRole('listitem');
    const guestRow = rows.find((row) => row.textContent.includes('Kahvaltı Misafiri'));
    expect(guestRow.querySelector('.evx-badge.tone-guest')).toBeTruthy();
    const attendeeRow = rows.find((row) => row.textContent.includes('Ayşe Yılmaz'));
    expect(attendeeRow.querySelector('.evx-badge.tone-guest')).toBeFalsy();
  });

  it('kahvaltı almayan (breakfast none) satırlar listede görünmez', async () => {
    const notComing = attendee({ id: '3', full_name: 'Kahvaltısız', breakfast: 'none' });
    api.getEventDay.mockResolvedValue(dayData([attendee(), notComing]));
    renderPage();

    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.queryByText('Kahvaltısız')).not.toBeInTheDocument();
  });

  it('"Misafir ekle" öğrenci olmayan hafif kayıt formunu açar, "Almayacak" seçeneği yok, ders ücreti yazmaz', async () => {
    api.getEventDay.mockResolvedValue(dayData([]));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Misafir ekle/ }));
    expect(await screen.findByText('Yeni kahvaltı misafiri')).toBeInTheDocument();
    expect(screen.getByLabelText('Ad soyad')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Almayacak' })).not.toBeInTheDocument();
    // Normal öğrencide olduğu gibi misafirde de "stüdyo karşılar" seçilebilir.
    expect(screen.getByRole('button', { name: 'Stüdyo öder' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Ad soyad'), { target: { value: 'Misafir Kişi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Nakit' }));
    fireEvent.click(screen.getByRole('button', { name: /Tam ödeme/ }));
    // Sadece kahvaltı misafirinde tam ödeme yalnız kahvaltı ücretini kapsar,
    // ders ücreti hiç görünmez.
    expect(screen.getByLabelText('Alınan tutar')).toHaveValue('650');
    expect(screen.queryByText(/^Ders /)).not.toBeInTheDocument();

    api.createEventDayEntry.mockResolvedValue({ id: '9', full_name: 'Misafir Kişi' });
    fireEvent.click(screen.getByRole('button', { name: /Listeye ekle/ }));
    await waitFor(() => expect(api.createEventDayEntry).toHaveBeenCalledWith('1', {
      fullName: 'Misafir Kişi',
      phone: null,
      amount: '650',
      paymentMethod: 'cash',
      breakfast: 'paid_to_us',
      note: null,
      breakfastOnly: true,
    }));
  });

  it('mevcut sadece-kahvaltı misafirini düzenlerken kısıtlar aynen uygulanır', async () => {
    api.getEventDay.mockResolvedValue(dayData([guest()]));
    renderPage();

    const [openBtn] = await screen.findAllByRole('button', { name: /Kahvaltı Misafiri/ });
    fireEvent.click(openBtn);
    expect(await screen.findByText('SADECE KAHVALTI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Almayacak' })).not.toBeInTheDocument();
  });
});
