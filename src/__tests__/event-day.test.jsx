import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileEventDay } from '../mobile/events/MobileEventDay';
import {
  breakfastOptionsFor,
  foldTr,
  formatPhoneMask,
  fullAmountFor,
  phoneDigitsFromInput,
  validateEntryDraft,
} from '../mobile/events/eventDayUtils';
import * as api from '../api';

vi.mock('../api', () => ({
  getEventDay: vi.fn(),
  searchEventDay: vi.fn(),
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
      breakfastCount: 0,
      breakfastPaidToUs: 0,
      breakfastPaidToRestaurant: 0,
      breakfastFree: 0,
      breakfastCollected: '0.00',
      restaurantOwed: '0.00',
    },
    entries,
  };
}

function renderDay(props = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MobileEventDay eventId="1" onBack={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

// evd-stats artık süzgeç değil, düz bilgi (bkz. MobileEventDay.jsx yorumu) —
// {label}/{değer} ayrı span/strong kardeş; değeri label metninden okuruz.
function statValue(label) {
  return screen.getByText(label).nextElementSibling.textContent;
}

async function openNewPerson(name) {
  fireEvent.change(await screen.findByLabelText('Kişi ara'), { target: { value: name } });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`"${name}" yeni kişi olarak ekle`) }));
}

describe('eventDayUtils', () => {
  it('telefonu yalnız 5 ile başlayan 10 haneye indirger', () => {
    expect(phoneDigitsFromInput('0 (532) 123 45 67')).toBe('5321234567');
    expect(phoneDigitsFromInput('+90 532 123 45 67')).toBe('5321234567');
    expect(phoneDigitsFromInput('05321234567999')).toBe('5321234567');
    expect(phoneDigitsFromInput('0212')).toBe('');
    expect(phoneDigitsFromInput('0')).toBe('');
    expect(formatPhoneMask('5321234567')).toBe('0 (532) 123 45 67');
    expect(formatPhoneMask('532')).toBe('0 (532');
  });

  it('Türkçe harfleri katlar', () => {
    expect(foldTr('AYŞE Işık İnce Çağrı')).toBe('ayse isik ince cagri');
  });

  it('tam ödemeyi kahvaltı durumuna göre hesaplar', () => {
    expect(fullAmountFor(PRICING, 'paid_to_us')).toBe(1700);
    expect(fullAmountFor(PRICING, 'paid_to_restaurant')).toBe(1050);
    expect(fullAmountFor(PRICING, 'free')).toBe(1050);
    expect(fullAmountFor(PRICING, 'none')).toBe(1050);
  });

  it('sadece kahvaltı misafirinde tam ödeme ders ücretini hiç saymaz', () => {
    expect(fullAmountFor(PRICING, 'paid_to_us', { skipLesson: true })).toBe(650);
    expect(fullAmountFor(PRICING, 'paid_to_restaurant', { skipLesson: true })).toBe(0);
    expect(fullAmountFor(PRICING, 'free', { skipLesson: true })).toBe(0);
  });

  it('sadece kahvaltı misafirinde "Almayacak" seçeneği sunulmaz', () => {
    expect(breakfastOptionsFor(false).map((o) => o.id)).toContain('none');
    expect(breakfastOptionsFor(true).map((o) => o.id)).not.toContain('none');
  });

  it('kahvaltı bize ödendiyse tutar kahvaltı fiyatının altında olamaz', () => {
    const base = { method: 'cash', pricing: PRICING, isLight: false };
    expect(validateEntryDraft({ ...base, amount: '600', breakfast: 'paid_to_us' }).code).toBe('breakfast');
    expect(validateEntryDraft({ ...base, amount: '650', breakfast: 'paid_to_us' })).toBeNull();
    expect(validateEntryDraft({ ...base, amount: '500', method: null, breakfast: 'none' }).code).toBe('method');
    expect(validateEntryDraft({ ...base, amount: '0', method: null, breakfast: 'free' })).toBeNull();
    expect(validateEntryDraft({ ...base, amount: '', breakfast: 'none' }).code).toBe('amount');
  });
});

describe('MobileEventDay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getEventDay.mockResolvedValue(dayData());
    api.createEventDayEntry.mockResolvedValue({ id: '9', full_name: 'Yeni' });
  });

  it('kayıtlı öğrenciyi nakit tam ödemeyle ekler', async () => {
    api.searchEventDay.mockResolvedValue([
      { kind: 'student', student_id: '5', entry_id: null, full_name: 'Ayşe Yılmaz', nickname: null, phone: '05321234567', pre_registered: true },
    ]);
    renderDay();

    fireEvent.change(await screen.findByLabelText('Kişi ara'), { target: { value: 'ayse' } });
    fireEvent.click(await screen.findByRole('button', { name: /Ayşe Yılmaz/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nakit' }));
    fireEvent.click(screen.getByRole('button', { name: /Tam ödeme/ }));
    expect(screen.getByLabelText('Alınan tutar')).toHaveValue('1700');

    fireEvent.click(screen.getByRole('button', { name: /Listeye ekle/ }));
    await waitFor(() => expect(api.createEventDayEntry).toHaveBeenCalledWith('1', {
      studentId: '5',
      amount: '1700',
      paymentMethod: 'cash',
      breakfast: 'paid_to_us',
      note: null,
    }));
  });

  it('kartla ödeyen yeni kişide kahvaltı restorana geçer, tam ödeme yalnız dersi alır', async () => {
    api.searchEventDay.mockResolvedValue([]);
    renderDay();

    await openNewPerson('Zeynep Kaya');
    fireEvent.change(await screen.findByLabelText('Telefon'), { target: { value: '05441112233' } });
    expect(screen.getByLabelText('Telefon')).toHaveValue('0 (544) 111 22 33');
    fireEvent.click(screen.getByRole('button', { name: 'Kart' }));
    expect(screen.getByRole('button', { name: 'Restorana kendi öder' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Tam ödeme/ }));
    expect(screen.getByLabelText('Alınan tutar')).toHaveValue('1050');

    fireEvent.click(screen.getByRole('button', { name: /Listeye ekle/ }));
    await waitFor(() => expect(api.createEventDayEntry).toHaveBeenCalledWith('1', {
      fullName: 'Zeynep Kaya',
      phone: '5441112233',
      amount: '1050',
      paymentMethod: 'card',
      breakfast: 'paid_to_restaurant',
      note: null,
    }));
  });

  it('kahvaltı almayacak kişi tek dokunuşla seçilir, tutar yalnız dersi kapsar', async () => {
    api.searchEventDay.mockResolvedValue([]);
    renderDay();

    await openNewPerson('Kaan');
    fireEvent.click(await screen.findByRole('button', { name: 'Nakit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Almayacak' }));
    fireEvent.click(screen.getByRole('button', { name: /Tam ödeme/ }));
    expect(screen.getByLabelText('Alınan tutar')).toHaveValue('1050');

    fireEvent.click(screen.getByRole('button', { name: /Listeye ekle/ }));
    await waitFor(() => expect(api.createEventDayEntry).toHaveBeenCalledWith('1', {
      fullName: 'Kaan',
      phone: null,
      amount: '1050',
      paymentMethod: 'cash',
      breakfast: 'none',
      note: null,
    }));
  });

  it('tam ödemeyle doldurulan tutar yöntem değişince kahvaltıyı izler', async () => {
    api.searchEventDay.mockResolvedValue([]);
    renderDay();

    await openNewPerson('Ece');
    fireEvent.click(await screen.findByRole('button', { name: 'Nakit' }));
    fireEvent.click(screen.getByRole('button', { name: /Tam ödeme/ }));
    expect(screen.getByLabelText('Alınan tutar')).toHaveValue('1700');
    fireEvent.click(screen.getByRole('button', { name: 'Kart' }));
    expect(screen.getByLabelText('Alınan tutar')).toHaveValue('1050');
  });

  it('kahvaltı bize ödendiyse eksik tutarla kaydetmez', async () => {
    api.searchEventDay.mockResolvedValue([]);
    renderDay();

    await openNewPerson('Mert');
    fireEvent.click(await screen.findByRole('button', { name: 'Nakit' }));
    fireEvent.change(screen.getByLabelText('Alınan tutar'), { target: { value: '600' } });
    expect(screen.getByRole('button', { name: /Listeye ekle/ })).toBeDisabled();
    expect(screen.getByText(/Kahvaltı ücreti \(650 ₺\) tam alınmalı/)).toBeInTheDocument();
  });

  it('beklenenden fazla tutar girilince uyarır ama kaydı engellemez (kısmi ödeme serbest kalır)', async () => {
    api.searchEventDay.mockResolvedValue([]);
    renderDay();

    await openNewPerson('Fazla Ödeyen');
    fireEvent.click(await screen.findByRole('button', { name: 'Nakit' }));
    fireEvent.change(screen.getByLabelText('Alınan tutar'), { target: { value: '1800' } });
    expect(screen.getByText(/Beklenenden fazla — tam ödeme 1\.700 ₺ olmalı/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Listeye ekle/ })).not.toBeDisabled();

    // Kısmi (eksik) ödeme meşrudur, uyarı tetiklemez.
    fireEvent.change(screen.getByLabelText('Alınan tutar'), { target: { value: '500' } });
    expect(screen.queryByText(/Beklenenden fazla/)).not.toBeInTheDocument();
  });

  it('telefonla aranıp bulunamayan kişiyi numarası hazır açar', async () => {
    api.searchEventDay.mockResolvedValue([]);
    renderDay();

    fireEvent.change(await screen.findByLabelText('Kişi ara'), { target: { value: '0532 987 65 43' } });
    fireEvent.click(await screen.findByRole('button', { name: /Bu numarayla yeni kişi ekle/ }));
    expect(await screen.findByLabelText('Telefon')).toHaveValue('0 (532) 987 65 43');
    expect(screen.getByLabelText('Ad soyad')).toHaveValue('');
  });

  it('numara listedeki birine aitse "Kaydı aç" mevcut satırı düzenlemeye açar', async () => {
    const entry = {
      id: '7', event_id: '1', student_id: '5', full_name: 'Ayşe Yılmaz', nickname: null, phone: '0532 111 22 33',
      is_light: false, pre_registered: true, amount: '1700.00', payment_method: 'cash', breakfast: 'paid_to_us',
      note: null, checked_at: null, checked_by_name: null, created_at: '2026-09-13T06:00:00Z',
      created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    api.getEventDay.mockResolvedValue(dayData([entry]));
    api.searchEventDay.mockResolvedValue([
      { kind: 'student', student_id: '5', entry_id: '7', full_name: 'Ayşe Yılmaz', nickname: null, phone: '0532 111 22 33', pre_registered: true },
    ]);
    renderDay();

    fireEvent.change(await screen.findByLabelText('Kişi ara'), { target: { value: '0532 111 22 33' } });
    fireEvent.click(await screen.findByRole('button', { name: /Bu numarayla yeni kişi ekle/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kaydı aç' }));

    expect(await screen.findByRole('button', { name: /Kaydı sil/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Alınan tutar')).toHaveValue('1700');
    expect(screen.queryByLabelText('Ad soyad')).not.toBeInTheDocument();
  });

  it('restorana kendi öder onaysız başlar, fiş görülünce onaylanabilir', async () => {
    const entry = {
      id: '9', event_id: '1', student_id: null, full_name: 'Fişli Kişi', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1050.00', payment_method: 'card', breakfast: 'paid_to_restaurant',
      note: null, checked_at: null, checked_by_name: null,
      breakfast_confirmed_at: null, breakfast_confirmed_by_name: null,
      created_at: '2026-09-13T06:00:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    api.getEventDay.mockResolvedValue(dayData([entry]));
    api.updateEventDayEntry.mockResolvedValue({
      ...entry, breakfast_confirmed_at: '2026-09-13T07:00:00Z', breakfast_confirmed_by_name: 'Efe',
    });
    renderDay();

    const [openBtn] = await screen.findAllByRole('button', { name: /Fişli Kişi/ });
    fireEvent.click(openBtn);
    expect(await screen.findByText('Henüz gelmedi — restoran fişini getirince açın')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Kahvaltı fişi verildi' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Kahvaltı fişi verildi' }));
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));

    await waitFor(() => expect(api.updateEventDayEntry).toHaveBeenCalledWith('9', {
      amount: '1050',
      paymentMethod: 'card',
      breakfast: 'paid_to_restaurant',
      note: null,
      breakfastConfirmed: true,
      fullName: 'Fişli Kişi',
      phone: null,
    }));
  });

  it('kahvaltı fişi verilmiş kayıt onaylayanı gösterir', async () => {
    const entry = {
      id: '10', event_id: '1', student_id: null, full_name: 'Onaylı Kişi', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1050.00', payment_method: 'card', breakfast: 'paid_to_restaurant',
      note: null, checked_at: null, checked_by_name: null,
      breakfast_confirmed_at: '2026-09-13T07:15:00Z', breakfast_confirmed_by_name: 'Ceren',
      created_at: '2026-09-13T06:00:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    api.getEventDay.mockResolvedValue(dayData([entry]));
    renderDay();

    const [openBtn] = await screen.findAllByRole('button', { name: /Onaylı Kişi/ });
    fireEvent.click(openBtn);
    expect(await screen.findByText(/Ceren ·/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Kahvaltı fişi verildi' })).toBeChecked();
  });

  it('listede kahvaltı fişi bekleyeni rozetle ve süzgeçle gösterir', async () => {
    const pending = {
      id: '11', event_id: '1', student_id: null, full_name: 'Bekleyen', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1050.00', payment_method: 'card', breakfast: 'paid_to_restaurant',
      note: null, checked_at: null, checked_by_name: null,
      breakfast_confirmed_at: null, breakfast_confirmed_by_name: null,
      created_at: '2026-09-13T06:00:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    const confirmed = {
      id: '12', event_id: '1', student_id: null, full_name: 'Onaylanan', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1050.00', payment_method: 'card', breakfast: 'paid_to_restaurant',
      note: null, checked_at: null, checked_by_name: null,
      breakfast_confirmed_at: '2026-09-13T07:00:00Z', breakfast_confirmed_by_name: 'Efe',
      created_at: '2026-09-13T06:00:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    const day = dayData([pending, confirmed]);
    day.summary.breakfastCount = 2;
    day.summary.breakfastPaidToRestaurant = 2;
    api.getEventDay.mockResolvedValue(day);
    renderDay();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const withinBadge = (row) => row.querySelector('.evx-badge.tone-amber');
    const pendingRow = rows.find((row) => row.textContent.includes('Bekleyen'));
    const confirmedRow = rows.find((row) => row.textContent.includes('Onaylanan'));
    expect(withinBadge(pendingRow)).toBeTruthy();
    expect(withinBadge(confirmedRow)).toBeFalsy();

    fireEvent.click(await screen.findByRole('button', { name: 'Kahvaltı fişi bekliyor · 1' }));
    await waitFor(() => expect(screen.queryByText('Onaylanan')).not.toBeInTheDocument());
    expect(screen.getByText('Bekleyen')).toBeInTheDocument();
  });

  it('kahvaltı fişi bekleyenler kpi kartındaki toplama yansımaz, ayrıca beklenen yazılır', async () => {
    const confirmed = {
      id: '20', event_id: '1', student_id: null, full_name: 'Verilen', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '650.00', payment_method: 'cash', breakfast: 'paid_to_us',
      note: null, checked_at: null, checked_by_name: null, created_at: '2026-09-13T06:00:00Z',
      created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    const pending = {
      id: '21', event_id: '1', student_id: null, full_name: 'Bekleyen', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1050.00', payment_method: 'card', breakfast: 'paid_to_restaurant',
      note: null, checked_at: null, checked_by_name: null,
      breakfast_confirmed_at: null, breakfast_confirmed_by_name: null,
      created_at: '2026-09-13T06:01:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:01:00Z', updated_by_name: 'Efe',
    };
    const day = dayData([confirmed, pending]);
    day.summary.breakfastCount = 2;
    day.summary.breakfastPaidToUs = 1;
    day.summary.breakfastPaidToRestaurant = 1;
    api.getEventDay.mockResolvedValue(day);
    renderDay();

    // Onaysız restoran kaydı toplam "verildi" sayısına girmez (yalnız 1 fiş
    // fiilen verilmiş); bekleyen kişi sayısı ayrıca yazılır.
    expect(await screen.findByText('1 fiş verildi')).toBeInTheDocument();
    expect(screen.getByText('1 fiş bekliyor')).toBeInTheDocument();
  });

  it('"Restoranda" yalnız fişi onaylanmışları sayar; onaylanan "Fiş bekliyor"dan "Restoranda"ya geçer', async () => {
    const paidToUs = {
      id: '30', event_id: '1', student_id: null, full_name: 'Bize Ödeyen', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '650.00', payment_method: 'cash', breakfast: 'paid_to_us',
      note: null, checked_at: null, checked_by_name: null, created_at: '2026-09-13T06:00:00Z',
      created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    const free = {
      id: '31', event_id: '1', student_id: null, full_name: 'Stüdyo Öder', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '0.00', payment_method: null, breakfast: 'free',
      note: null, checked_at: null, checked_by_name: null, created_at: '2026-09-13T06:01:00Z',
      created_by_name: 'Efe', updated_at: '2026-09-13T06:01:00Z', updated_by_name: 'Efe',
    };
    const restaurantPending = {
      id: '32', event_id: '1', student_id: null, full_name: 'Fiş Bekleyen', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1050.00', payment_method: 'card', breakfast: 'paid_to_restaurant',
      note: null, checked_at: null, checked_by_name: null,
      breakfast_confirmed_at: null, breakfast_confirmed_by_name: null,
      created_at: '2026-09-13T06:02:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:02:00Z', updated_by_name: 'Efe',
    };
    const day = dayData([paidToUs, free, restaurantPending]);
    day.summary.breakfastCount = 3;
    day.summary.breakfastPaidToUs = 1;
    day.summary.breakfastFree = 1;
    day.summary.breakfastPaidToRestaurant = 1;
    api.getEventDay.mockResolvedValue(day);
    renderDay();

    // Onaylanmamış restoran ödemesi henüz "Restoranda" değil, "Fiş bekliyor".
    expect(await screen.findByText('2 fiş verildi')).toBeInTheDocument();
    expect(screen.getByText('1 fiş bekliyor')).toBeInTheDocument();
    expect(statValue('Restoranda')).toBe('0');
    expect(statValue('Fiş bekliyor')).toBe('1');

    // Fiş teslim edilip onaylanınca "Restoranda"ya geçer, "Fiş bekliyor"dan düşer.
    api.updateEventDayEntry.mockResolvedValue({ ...restaurantPending, breakfast_confirmed_at: '2026-09-13T07:00:00Z' });
    const dayAfterConfirm = dayData([paidToUs, free, { ...restaurantPending, breakfast_confirmed_at: '2026-09-13T07:00:00Z' }]);
    dayAfterConfirm.summary = { ...day.summary };
    api.getEventDay.mockResolvedValue(dayAfterConfirm);

    const [openBtn] = await screen.findAllByRole('button', { name: /Fiş Bekleyen/ });
    fireEvent.click(openBtn);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Kahvaltı fişi verildi' }));
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));

    expect(await screen.findByText('3 fiş verildi')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ fiş bekliyor$/)).not.toBeInTheDocument();
    expect(statValue('Restoranda')).toBe('1');
  });

  it('silinen kaydı "Geri al" ile geri getirir', async () => {
    const entry = {
      id: '8', event_id: '1', student_id: null, full_name: 'Can', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '0.00', payment_method: null, breakfast: 'free',
      note: null, checked_at: null, checked_by_name: null, created_at: '2026-09-13T06:00:00Z',
      created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    api.getEventDay.mockResolvedValue(dayData([entry]));
    api.deleteEventDayEntry.mockResolvedValue(undefined);
    api.restoreEventDayEntry.mockResolvedValue(entry);
    renderDay();

    fireEvent.click(await screen.findByRole('button', { name: /Ücretsiz · Kahvaltı stüdyo öder/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Kaydı sil/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Evet, sil' }));
    await waitFor(() => expect(api.deleteEventDayEntry).toHaveBeenCalledWith('8'));
    // vaul'un kapanış geçişi jsdom'da tamamlanmadığından panel "açık" sayılır
    // ve Radix sayfanın geri kalanını aria-hidden bırakır (bkz.
    // mobile-notes.test.jsx) — bildirim düğmesi gizli öğeler arasında aranır.
    fireEvent.click(await screen.findByRole('button', { name: 'Geri al', hidden: true }));
    await waitFor(() => expect(api.restoreEventDayEntry).toHaveBeenCalledWith('8'));
  });

  it('Kahvaltı kartına (başlığa ya da "Listeyi gör"e) tıklayınca kahvaltı listesi açılır', async () => {
    const data = dayData([]);
    data.summary.breakfastCount = 2;
    data.summary.breakfastPaidToUs = 2;
    api.getEventDay.mockResolvedValue(data);
    const onOpenBreakfast = vi.fn();
    renderDay({ onOpenBreakfast });

    fireEvent.click(await screen.findByRole('button', { name: 'Kahvaltı listesini aç' }));
    expect(onOpenBreakfast).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Listeyi gör/ }));
    expect(onOpenBreakfast).toHaveBeenCalledTimes(2);
  });

  it('sadece kahvaltı misafirleri ana kapı listesinde görünmez', async () => {
    const attendee = {
      id: '40', event_id: '1', student_id: null, full_name: 'Katılımcı', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1700.00', payment_method: 'cash', breakfast: 'paid_to_us',
      breakfast_only: false, note: null, checked_at: null, checked_by_name: null,
      created_at: '2026-09-13T06:00:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    const guest = {
      id: '41', event_id: '1', student_id: null, full_name: 'Kahvaltı Misafiri', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '650.00', payment_method: 'cash', breakfast: 'paid_to_us',
      breakfast_only: true, note: null, checked_at: null, checked_by_name: null,
      created_at: '2026-09-13T06:01:00Z', created_by_name: 'Efe', updated_at: '2026-09-13T06:01:00Z', updated_by_name: 'Efe',
    };
    const day = dayData([attendee, guest]);
    day.summary.people = 2;
    api.getEventDay.mockResolvedValue(day);
    renderDay();

    expect(await screen.findByText('Katılımcı')).toBeInTheDocument();
    expect(screen.queryByText('Kahvaltı Misafiri')).not.toBeInTheDocument();
    // Toplam "N kişi" sayacı sunucudan geldiği gibi ikisini de sayar.
    expect(screen.getByText('2').closest('.evd-progress-text')).toBeInTheDocument();
  });

  it('listedeki satırı sağa kaydırarak (veya sağ ok tuşuyla) tikler', async () => {
    const entry = {
      id: '7', event_id: '1', student_id: null, full_name: 'Deniz', nickname: null, phone: null,
      is_light: true, pre_registered: false, amount: '1700.00', payment_method: 'cash', breakfast: 'paid_to_us',
      note: null, checked_at: null, checked_by_name: null, created_at: '2026-09-13T06:00:00Z',
      created_by_name: 'Efe', updated_at: '2026-09-13T06:00:00Z', updated_by_name: 'Efe',
    };
    api.getEventDay.mockResolvedValue(dayData([entry]));
    api.updateEventDayEntry.mockResolvedValue({ ...entry, checked_at: '2026-09-13T06:05:00Z' });
    renderDay();

    const row = (await screen.findByText('Deniz')).closest('.evd-entry-main');
    // Sağa kaydırma jestinin klavye eşdeğeri: satıra odaklanıp sağ ok tuşuna basmak.
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    await waitFor(() => expect(api.updateEventDayEntry).toHaveBeenCalledWith('7', { checked: true }));
  });
});
