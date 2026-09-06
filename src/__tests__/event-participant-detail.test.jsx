import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventParticipantDetail } from '../mobile/events/MobileEventParticipantDetail';
import { CurrentUserProvider } from '../currentUser';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventById: vi.fn(), getEventParticipants: vi.fn(), getEventParticipantFees: vi.fn(), getEventVehicles: vi.fn(),
  updateEventParticipant: vi.fn(), updateEventParticipantFee: vi.fn(),
  recordEventParticipantPayment: vi.fn(), getEventParticipantPayments: vi.fn(),
  cancelEventParticipantPayment: vi.fn(), removeEventParticipant: vi.fn(),
  getEventParticipantNotes: vi.fn(), addEventParticipantNote: vi.fn(),
  updateEventParticipantNote: vi.fn(), deleteEventParticipantNote: vi.fn(),
}));

let fees;
let totalPaid;
beforeEach(() => {
  vi.clearAllMocks();
  totalPaid = 0;
  fees = [
    { fee_item_id: '10', label: 'Ders ücreti', is_lesson_fee: true, coverage: 'student', base_amount_snapshot: '1050.00', amount_snapshot: '1050.00', paid_amount: '0' },
    { fee_item_id: '11', label: 'Kahvaltı', is_lesson_fee: false, coverage: 'student', base_amount_snapshot: '650.00', amount_snapshot: '650.00', paid_amount: '0' },
  ];
  api.getEventById.mockResolvedValue({ name: 'Pamucak Etkinliği' });
  api.getEventParticipantFees.mockImplementation(async () => fees.map((f) => ({ ...f })));
  api.getEventParticipantPayments.mockResolvedValue([]);
  api.getEventParticipantNotes.mockResolvedValue([]);
  api.getEventParticipants.mockImplementation(async () => [{
    id: '2', student_id: '3', student_name: 'Ayşe', role: 'regular', rsvp_status: 'coming',
    total_due: fees.reduce((sum, f) => sum + Number(f.amount_snapshot), 0), total_paid: String(totalPaid),
  }]);
  api.recordEventParticipantPayment.mockImplementation(async (_participant, input) => {
    totalPaid += Number(input.amount);
    return { amount: input.amount, source: input.source };
  });
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
    fireEvent.click(screen.getByRole('button', { name: 'Ödeme al' }));
    expect(screen.getByLabelText('Ödeme tutarı')).toHaveValue('');
    expect(screen.getByText(/En fazla/)).toHaveTextContent('1.450,5');
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
    fireEvent.click(screen.getByRole('button', { name: 'Ödeme al' }));
    fireEvent.change(screen.getByPlaceholderText('Tutar'), { target: { value: '100,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'IBAN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.recordEventParticipantPayment).toHaveBeenCalledWith('2', {
      amount: '100.50',
      source: 'iban',
      idempotencyKey: expect.any(String),
    }));
    await waitFor(() => expect(screen.getByText(/Kısmi ödeme/)).toBeInTheDocument());
    expect(screen.getByText(/Kısmi ödeme/).parentElement).toHaveTextContent('1.599,5');
  });

  it('kalan tutardan fazla tahsilatı frontend tarafında da engeller', async () => {
    await openFees();
    fireEvent.click(screen.getByRole('button', { name: 'Ödeme al' }));
    fireEvent.change(screen.getByLabelText('Ödeme tutarı'), { target: { value: '1700,01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('kalan 1.700 ₺ tutarı aşamaz');
    expect(api.recordEventParticipantPayment).not.toHaveBeenCalled();
  });
});

describe('Katılımcı profili not günlüğü', () => {
  async function renderDetail(user = { id: '9', displayName: 'Deniz Yönetici' }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CurrentUserProvider user={user}>
          <MobileEventParticipantDetail eventId="1" participantId="2" />
        </CurrentUserProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Notlar' }));
  }

  it('notu Gönder ile ekler, yazar adını gösterir', async () => {
    api.addEventParticipantNote.mockResolvedValue({});
    await renderDetail();
    expect(await screen.findByText('Bu kişi için henüz not yok')).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText('Bu kişinin bu etkinlikteki durumu hakkında not yazın…');
    fireEvent.change(textarea, { target: { value: 'Kahvaltıya geç kalabilir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() => expect(api.addEventParticipantNote).toHaveBeenCalledWith('2', 'Kahvaltıya geç kalabilir'));
    expect(api.getEventParticipantNotes).toHaveBeenCalledTimes(2); // ilk yükleme + gönderdikten sonra invalidate
  });

  it('boş not gönderilmez', async () => {
    await renderDetail();
    await screen.findByText('Bu kişi için henüz not yok');
    expect(screen.getByRole('button', { name: 'Gönder' })).toBeDisabled();
    expect(api.addEventParticipantNote).not.toHaveBeenCalled();
  });

  it('yalnız kendi notu için düzenle/sil menüsünü gösterir; başkasının notunda menü yok', async () => {
    api.getEventParticipantNotes.mockResolvedValue([
      { id: '101', author_user_id: '9', author_name: 'Deniz Yönetici', body: 'Kendi notum', created_at: '2026-09-06T10:00:00Z', updated_at: '2026-09-06T10:00:00Z' },
      { id: '102', author_user_id: '5', author_name: 'Başka Kullanıcı', body: 'Başkasının notu', created_at: '2026-09-06T09:00:00Z', updated_at: '2026-09-06T09:00:00Z' },
    ]);
    await renderDetail({ id: '9', displayName: 'Deniz Yönetici' });
    expect(await screen.findByText('Kendi notum')).toBeInTheDocument();
    expect(screen.getByText('Başkasının notu')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Not işlemleri')).toHaveLength(1);
  });

  it('kendi notunu düzenler', async () => {
    api.getEventParticipantNotes.mockResolvedValue([
      { id: '101', author_user_id: '9', author_name: 'Deniz Yönetici', body: 'Eski metin', created_at: '2026-09-06T10:00:00Z', updated_at: '2026-09-06T10:00:00Z' },
    ]);
    api.updateEventParticipantNote.mockResolvedValue({
      id: '101', author_user_id: '9', author_name: 'Deniz Yönetici', body: 'Yeni metin', created_at: '2026-09-06T10:00:00Z', updated_at: '2026-09-06T10:05:00Z',
    });
    await renderDetail({ id: '9', displayName: 'Deniz Yönetici' });
    await screen.findByText('Eski metin');
    fireEvent.click(screen.getByLabelText('Not işlemleri'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Düzenle/ }));
    const editArea = screen.getByDisplayValue('Eski metin');
    fireEvent.change(editArea, { target: { value: 'Yeni metin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.updateEventParticipantNote).toHaveBeenCalledWith('101', 'Yeni metin'));
    expect(await screen.findByText('Yeni metin')).toBeInTheDocument();
    expect(screen.getByText(/düzenlendi/)).toBeInTheDocument();
  });

  it('kendi notunu siler', async () => {
    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    api.getEventParticipantNotes.mockResolvedValue([
      { id: '101', author_user_id: '9', author_name: 'Deniz Yönetici', body: 'Silinecek not', created_at: '2026-09-06T10:00:00Z', updated_at: '2026-09-06T10:00:00Z' },
    ]);
    api.deleteEventParticipantNote.mockResolvedValue(undefined);
    await renderDetail({ id: '9', displayName: 'Deniz Yönetici' });
    await screen.findByText('Silinecek not');
    fireEvent.click(screen.getByLabelText('Not işlemleri'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Sil/ }));
    await waitFor(() => expect(api.deleteEventParticipantNote).toHaveBeenCalledWith('101'));
    expect(screen.queryByText('Silinecek not')).not.toBeInTheDocument();
    window.confirm = originalConfirm;
  });

  it('Genel ve Notlar sekmelerini ayırır; arama ve etiketleme notlarını aynı akışta gösterir', async () => {
    api.getEventParticipantNotes.mockResolvedValue([
      {
        id: '201', source: 'contact_note', author_user_id: '9', author_name: 'Deniz Yönetici',
        body: 'Ulaşılamadı, yarın tekrar aranacak.', categories: [], has_image: false,
        created_at: '2026-09-06T11:00:00Z', updated_at: '2026-09-06T11:00:00Z',
      },
      {
        id: '55', source: 'mention', author_user_id: '5', author_name: 'Başka Kullanıcı',
        body: '@Ayşe vegan kahvaltı istedi.', categories: [{ id: '3', name: 'Beslenme' }], has_image: true,
        created_at: '2026-09-06T10:00:00Z', updated_at: '2026-09-06T10:00:00Z',
      },
    ]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MobileEventParticipantDetail eventId="1" participantId="2" /></QueryClientProvider>);

    expect(await screen.findByRole('tab', { name: 'Genel' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Notlar' }));
    expect(screen.getByRole('tab', { name: 'Notlar' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Ulaşılamadı, yarın tekrar aranacak.')).toBeInTheDocument();
    expect(screen.getByText('Arama notu')).toBeInTheDocument();
    expect(screen.getByText('@Ayşe vegan kahvaltı istedi.')).toBeInTheDocument();
    expect(screen.getByText('Genel notta etiketlendi')).toBeInTheDocument();
    expect(screen.getByText('Beslenme')).toBeInTheDocument();
    expect(screen.getByText('Fotoğraf ekli')).toBeInTheDocument();
    expect(screen.queryAllByLabelText('Not işlemleri')).toHaveLength(0);
  });
});
