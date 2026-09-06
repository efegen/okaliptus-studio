import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventParticipantDetail } from '../mobile/events/MobileEventParticipantDetail';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(), getEventParticipants: vi.fn(), getEventParticipantFees: vi.fn(), getEventVehicles: vi.fn(),
  updateEventParticipant: vi.fn(), updateEventParticipantFee: vi.fn(),
  recordEventParticipantPayment: vi.fn(), getEventParticipantPayments: vi.fn(),
  cancelEventParticipantPayment: vi.fn(), removeEventParticipant: vi.fn(),
}));

let fees;
beforeEach(() => {
  vi.clearAllMocks();
  fees = [
    { fee_item_id: '10', label: 'Ders ücreti', is_lesson_fee: true, coverage: 'student', base_amount_snapshot: '1050.00', amount_snapshot: '1050.00', paid_amount: '0' },
    { fee_item_id: '11', label: 'Kahvaltı', is_lesson_fee: false, coverage: 'student', base_amount_snapshot: '650.00', amount_snapshot: '650.00', paid_amount: '0' },
  ];
  api.getEventById.mockResolvedValue({ name: 'Pamucak Etkinliği' });
  api.getEventParticipantFees.mockImplementation(async () => fees.map((f) => ({ ...f })));
  api.getEventParticipantPayments.mockResolvedValue([]);
  api.getEventParticipants.mockImplementation(async () => [{
    id: '2', student_id: '3', student_name: 'Ayşe', role: 'regular', rsvp_status: 'coming',
    total_due: fees.reduce((sum, f) => sum + Number(f.amount_snapshot), 0), total_paid: '0',
  }]);
  api.updateEventParticipantFee.mockImplementation(async (_participant, id, input) => {
    const fee = fees.find((f) => f.fee_item_id === id);
    fee.amount_snapshot = input.amount;
  });
});

async function openFees() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MobileEventParticipantDetail eventId="1" participantId="2" /></QueryClientProvider>);
  const toggle = await screen.findByRole('button', { name: 'Ücretler · kimin ödeyeceği' });
  return toggle;
}

describe('Etkinlik katılımcısının ücretleri', () => {
  it('gelme durumunu önce gösterir; kapalı ücretlerde toplamı korur ve yalnız dersi düzenler', async () => {
    const toggle = await openFees();
    const attendance = screen.getByText('Gelme durumu');
    expect(attendance.compareDocumentPosition(screen.getByText('ROL')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Kahvaltı')).not.toBeInTheDocument();
    expect(screen.getByText('Katılımcıdan alınacak').parentElement).toHaveTextContent('1.700');
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Kahvaltı tutarını düzenle' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ders ücreti tutarını düzenle' }));
    fireEvent.change(screen.getByLabelText('Bu katılımcının ders ücreti (TL)'), { target: { value: '800,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.updateEventParticipantFee).toHaveBeenCalledWith('2', '10', { amount: '800.50' }));
    await waitFor(() => expect(screen.queryByLabelText('Bu katılımcının ders ücreti (TL)')).not.toBeInTheDocument());
    expect(screen.getByText('Katılımcıdan alınacak').parentElement).toHaveTextContent('1.450');
    fireEvent.click(screen.getByRole('button', { name: /ödeme al/ }));
    expect(screen.getByDisplayValue('1450.5')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Ders ücreti tutarını düzenle' })).not.toBeInTheDocument();
  });

  it.each([{ coverage: 'none', paid: '0' }, { coverage: 'student', paid: '100' }])('aktif olmayan veya ödenmiş derste kalem göstermez: %s', async ({ coverage, paid }) => {
    fees[0].coverage = coverage;
    fees[0].paid_amount = paid;
    fireEvent.click(await openFees());
    expect(screen.queryByRole('button', { name: 'Ders ücreti tutarını düzenle' })).not.toBeInTheDocument();
  });

  it('geçersiz tutarı göndermez; hata veya vazgeçme halinde toplam değişmez', async () => {
    fireEvent.click(await openFees());
    fireEvent.click(screen.getByRole('button', { name: 'Ders ücreti tutarını düzenle' }));
    const input = screen.getByLabelText('Bu katılımcının ders ücreti (TL)');
    fireEvent.change(input, { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Geçerli bir tutar');
    expect(api.updateEventParticipantFee).not.toHaveBeenCalled();
    api.updateEventParticipantFee.mockRejectedValueOnce(new Error('Ücret kaydedilemedi.'));
    fireEvent.change(input, { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Ücret kaydedilemedi.')).toBeInTheDocument();
    expect(input).toHaveValue('800');
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(screen.getByText('Katılımcıdan alınacak').parentElement).toHaveTextContent('1.700');
  });

  it('misafirin altına ikinci seviye misafir ekleme eylemi göstermez', async () => {
    api.getEventParticipants.mockResolvedValue([{
      id: '2', student_id: '3', student_name: 'Ayşe', role: 'regular', rsvp_status: 'coming',
      guest_of_participant_id: '1', total_due: '0', total_paid: '0',
    }]);
    await openFees();
    expect(await screen.findByText('Ayşe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Misafir ekle' })).not.toBeInTheDocument();
  });

  it('tahsilatta Türkçe ondalığı, ödeme kaynağını ve işlem anahtarını gönderir', async () => {
    await openFees();
    fireEvent.click(screen.getByRole('button', { name: /ödeme al/ }));
    fireEvent.change(screen.getByPlaceholderText('Tutar'), { target: { value: '100,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'IBAN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.recordEventParticipantPayment).toHaveBeenCalledWith('2', {
      amount: '100.50',
      source: 'iban',
      idempotencyKey: expect.any(String),
    }));
  });
});
