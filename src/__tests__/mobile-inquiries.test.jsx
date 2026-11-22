import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MobileInquiries } from '../mobile/inquiries/MobileInquiries';
import { MobileInquiryDetail } from '../mobile/inquiries/MobileInquiryDetail';
import { MobileInquirySuspects } from '../mobile/inquiries/MobileInquirySuspects';
import { InquiryInboxButton } from '../mobile/inquiries/InquiryInboxButton';
import { MobileHomeView } from '../mobile/home/MobileHomeView';
import {
  groupLabel,
  handledText,
  longTime,
  rowTime,
  telHref,
  whatsappHref,
} from '../mobile/inquiries/inquiryMeta';
import { queryKeysForWrite } from '../hooks/writeInvalidation';
import { can, canSeePage } from '../permissions';
import { CurrentUserProvider } from '../currentUser';
import * as api from '../api';

vi.mock('../api', () => ({
  getSiteInquiries: vi.fn(),
  getSiteInquiryCounts: vi.fn(),
  getSiteInquiry: vi.fn(),
  updateSiteInquiry: vi.fn(),
}));

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

function inquiry(overrides = {}) {
  return {
    id: '12',
    kind: 'camp',
    status: 'new',
    suspectReason: null,
    fullName: 'Ayşe Yılmaz',
    phone: '0532 123 45 67',
    email: 'ayse@ornek.com',
    message: null,
    details: {
      eventTitle: 'Pamukkale Yoga Kampı',
      eventDate: '18–20 Aralık 2026',
      entryLabel: 'Cuma girişi',
      people: 2,
      roomLabel: '2 ya da 3 kişilik oda',
      price: 'Kişi başı 13.500 TL',
    },
    summary: 'Pamukkale Yoga Kampı, 2 kişi, 2 ya da 3 kişilik oda',
    page: '/etkinlikler/pamukkale-yoga-kampi',
    duplicateOf: null,
    createdAt: minutesAgo(30),
    submissionCount: 1,
    lastSubmittedAt: minutesAgo(30),
    notifiedAt: minutesAgo(30),
    handledBy: null,
    handledAt: null,
    note: null,
    updatedAt: minutesAgo(30),
    student: null,
    ...overrides,
  };
}

function wrap(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrentUserProvider user={{ id: '10', displayName: 'Efe', role: 'admin' }}>
        {ui}
      </CurrentUserProvider>
    </QueryClientProvider>,
  );
}

describe('Talepler yardımcıları', () => {
  it('WhatsApp numarasını ülke koduyla kurar', () => {
    expect(whatsappHref('0532 123 45 67')).toBe('https://wa.me/905321234567');
    expect(whatsappHref('532 123 45 67')).toBe('https://wa.me/905321234567');
    expect(whatsappHref('+90 (532) 123 45 67')).toBe('https://wa.me/905321234567');
    expect(whatsappHref('0049 151 2345678')).toBe('https://wa.me/491512345678');
    expect(telHref('0532 123 45 67')).toBe('tel:05321234567');
  });

  it('kimin işlediğini yazar: ben → "Sen … yaptın", başkası → ad', () => {
    const base = inquiry({ status: 'contacted', handledAt: minutesAgo(5) });
    expect(handledText({ ...base, handledBy: { id: '10', name: 'Efe' } }, '10')).toMatch(/^Sen dönüş yaptın, bugün \d{2}:\d{2}$/);
    expect(handledText({ ...base, handledBy: { id: '11', name: 'Ceren' } }, '10')).toMatch(/^Ceren dönüş yaptı, /);
    expect(handledText({ ...base, status: 'converted', handledBy: { id: '10', name: 'Efe' } }, '10')).toMatch(/^Sen kesin kayda dönüştürdün/);
    expect(handledText({ ...base, status: 'new', handledBy: { id: '10', name: 'Efe' } }, '10')).toBe('');
  });

  it('Postgres zaman metnini İstanbul saatiyle okur', () => {
    const now = new Date('2026-11-22T12:00:00Z'); // İstanbul 15:00
    expect(longTime('2026-11-22 14:32:05.285496+03', now)).toBe('Bugün 14:32');
    expect(longTime('2026-11-21 18:40:00+03', now)).toBe('Dün 18:40');
    expect(rowTime('2026-11-19 09:00:00+03', now)).toBe('Per');
    expect(groupLabel('2026-11-21 18:40:00+03', now)).toBe('Dün');
    expect(groupLabel('2026-11-17 10:00:00+03', now)).toBe('Bu hafta');
    expect(groupLabel('2026-11-12 10:00:00+03', now)).toBe('Geçen hafta');
    expect(groupLabel('2026-10-02 10:00:00+03', now)).toBe('Ekim 2026');
  });

  it('canlı senkron ve yetki eşlemesi', () => {
    expect(queryKeysForWrite('PATCH', '/site-inquiries/5')).toEqual([['siteInquiries']]);
    expect(queryKeysForWrite('POST', '/site-inquiries')).toEqual([['siteInquiries']]);
    expect(can('admin', 'inquiries.manage')).toBe(true);
    expect(can('assistant', 'inquiries.manage')).toBe(false);
    expect(canSeePage('assistant', 'inquiry-detail')).toBe(false);
  });
});

describe('Ana sayfa talepler düğmesi', () => {
  it('rozet yeni talep sayısını gösterir, 99 üstü 99+', () => {
    const { rerender } = render(<InquiryInboxButton count={3} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Talepler, 3 yeni' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    rerender(<InquiryInboxButton count={150} onClick={() => {}} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
    rerender(<InquiryInboxButton count={0} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Talepler' })).toBeInTheDocument();
  });

  it('yetkili rolde profil harfinin yerine geçer; yetkisizde profil kalır', () => {
    const onOpen = vi.fn();
    const props = { dateLabel: '22 Kasım', headline: 'Bugün ders yok', user: { displayName: 'Efe' }, canSeeOrders: false };
    const { rerender } = render(<MobileHomeView {...props} canSeeInquiries inquiriesNew={2} onOpenInquiries={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Talepler, 2 yeni' }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Hesap menüsü' })).not.toBeInTheDocument();
    rerender(<MobileHomeView {...props} canSeeInquiries={false} />);
    expect(screen.queryByRole('button', { name: /^Talepler/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hesap menüsü' })).toBeInTheDocument();
  });
});

describe('Talepler listesi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSiteInquiryCounts.mockResolvedValue({ new: 2, contacted: 1, suspect: 3 });
  });

  it('satırları, rozetleri ve şüpheli bağlantısını gösterir', async () => {
    api.getSiteInquiries.mockResolvedValue({
      items: [
        inquiry({ submissionCount: 2 }),
        inquiry({
          id: '13', kind: 'lesson', fullName: 'Zeynep Kaya', phone: '0541 234 56 78',
          details: { modeLabel: 'Stüdyoda', city: 'İzmir' }, summary: 'Stüdyoda, İzmir',
          message: 'Merhaba, bel fıtığım var.', student: { id: '7', fullName: 'Zeynep Kaya' },
        }),
      ],
      counts: { new: 2, contacted: 1, suspect: 3 },
      nextBefore: null,
    });
    const onOpen = vi.fn();
    const onOpenSuspects = vi.fn();
    wrap(<MobileInquiries tab="new" kind="all" onChangeTab={() => {}} onChangeKind={() => {}} onBack={() => {}} onOpen={onOpen} onOpenSuspects={onOpenSuspects} />);

    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(api.getSiteInquiries).toHaveBeenCalledWith({ box: 'new', kind: '', before: '' });
    expect(screen.getByText('2 gönderim')).toBeInTheDocument();
    expect(screen.getByText('Kayıtlı öğrenci')).toBeInTheDocument();
    expect(screen.getByText('Merhaba, bel fıtığım var.')).toBeInTheDocument();
    expect(screen.getByText('Bugün')).toBeInTheDocument();
    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getByRole('tab', { name: /Yeni 2/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByText('Zeynep Kaya'));
    expect(onOpen).toHaveBeenCalledWith('13');
    fireEvent.click(await screen.findByText('3 şüpheli gönderim'));
    expect(onOpenSuspects).toHaveBeenCalled();
  });

  it('boşken boş durumu gösterir; tür çipi süzer', async () => {
    api.getSiteInquiries.mockResolvedValue({ items: [], counts: { new: 0, contacted: 0, suspect: 0 }, nextBefore: null });
    const onChangeKind = vi.fn();
    wrap(<MobileInquiries tab="done" kind="camp" onChangeTab={() => {}} onChangeKind={onChangeKind} onBack={() => {}} onOpen={() => {}} onOpenSuspects={() => {}} />);
    expect(await screen.findByText('Burada talep yok')).toBeInTheDocument();
    expect(api.getSiteInquiries).toHaveBeenCalledWith({ box: 'done', kind: 'camp', before: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Mesaj' }));
    expect(onChangeKind).toHaveBeenCalledWith('contact');
  });
});

describe('Talep detayı', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ön kayıt bilgilerini ve iletişim düğmelerini gösterir; ekle düğmeleri yok', async () => {
    api.getSiteInquiry.mockResolvedValue({
      ...inquiry({ submissionCount: 2 }),
      submissions: [
        { id: '11', createdAt: minutesAgo(42), summary: 'Pamukkale Yoga Kampı, 1 kişi', message: null, details: {} },
        { id: '12', createdAt: minutesAgo(30), summary: 'Pamukkale Yoga Kampı, 2 kişi', message: null, details: {} },
      ],
      related: [],
    });
    wrap(<MobileInquiryDetail inquiryId="12" onBack={() => {}} />);

    expect(await screen.findByRole('heading', { name: 'Ayşe Yılmaz' })).toBeInTheDocument();
    expect(screen.getByText('Cuma girişi')).toBeInTheDocument();
    expect(screen.getByText('2 kişi, kendisi dahil')).toBeInTheDocument();
    expect(screen.getByText('Kişi başı 13.500 TL')).toBeInTheDocument();
    expect(screen.getByText('Formu 2 kez gönderdi')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ara/ })).toHaveAttribute('href', 'tel:05321234567');
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/905321234567');
    expect(screen.getByRole('link', { name: /E-posta/ })).toHaveAttribute('href', 'mailto:ayse@ornek.com');
    expect(screen.queryByText(/Etkinliğe/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Öğrenci olarak ekle/)).not.toBeInTheDocument();
  });

  it('"Dönüş yaptım" durumu değiştirir, sonra türe göre bir sonraki adım çıkar', async () => {
    api.getSiteInquiry.mockResolvedValue({ ...inquiry(), submissions: [], related: [] });
    api.updateSiteInquiry.mockResolvedValue({
      ...inquiry({ status: 'contacted', handledBy: { id: '10', name: 'Efe' }, handledAt: minutesAgo(0) }),
      submissions: [],
      related: [],
    });
    wrap(<MobileInquiryDetail inquiryId="12" onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Dönüş yaptım' }));
    await waitFor(() => expect(api.updateSiteInquiry).toHaveBeenCalledWith('12', { status: 'contacted' }));
    expect(await screen.findByRole('button', { name: 'Kesin kayda dönüştü' })).toBeInTheDocument();
    expect(screen.getByText(/^Sen dönüş yaptın, bugün/)).toBeInTheDocument();
  });

  it('not odaktan çıkınca kaydedilir', async () => {
    api.getSiteInquiry.mockResolvedValue({ ...inquiry(), submissions: [], related: [] });
    api.updateSiteInquiry.mockResolvedValue({ ...inquiry({ note: 'Cuma aranacak.' }), submissions: [], related: [] });
    wrap(<MobileInquiryDetail inquiryId="12" onBack={() => {}} />);

    const box = await screen.findByLabelText('Not');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '  Cuma aranacak.  ' } });
    fireEvent.blur(box);
    await waitFor(() => expect(api.updateSiteInquiry).toHaveBeenCalledWith('12', { note: 'Cuma aranacak.' }));
    expect(await screen.findByText('Kaydedildi. Yalnız ekip görür.')).toBeInTheDocument();
  });

  it('kayıtlı öğrenci varsa profile götürür', async () => {
    api.getSiteInquiry.mockResolvedValue({
      ...inquiry({ kind: 'lesson', details: { mode: 'online', city: 'Ankara' }, student: { id: '7', fullName: 'Merve Aksoy' } }),
      submissions: [],
      related: [],
    });
    const onOpenStudent = vi.fn();
    wrap(<MobileInquiryDetail inquiryId="12" onBack={() => {}} onOpenStudent={onOpenStudent} />);
    expect(await screen.findByText('Online')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Profili aç'));
    expect(onOpenStudent).toHaveBeenCalledWith('7');
  });
});

describe('Şüpheli gönderimler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gerçek olanı Yeni\'ye alır, spamı geri alabilir', async () => {
    api.getSiteInquiries.mockResolvedValue({
      items: [
        inquiry({ id: '21', fullName: 'Ahmet Koç', suspectReason: 'too_fast' }),
        inquiry({ id: '20', kind: 'contact', fullName: 'Test Test', suspectReason: 'trap', summary: 'Sitenizi öne çıkarıyoruz.' }),
      ],
      counts: { new: 0, contacted: 0, suspect: 2 },
      nextBefore: null,
    });
    api.updateSiteInquiry.mockResolvedValue({});
    wrap(<MobileInquirySuspects onBack={() => {}} />);

    expect(await screen.findByText('Çok hızlı gönderildi')).toBeInTheDocument();
    expect(screen.getByText('Tarayıcı formu otomatik doldurmuş olabilir.')).toBeInTheDocument();

    const [realFirst] = screen.getAllByRole('button', { name: "Gerçek, Yeni'ye al" });
    fireEvent.click(realFirst);
    await waitFor(() => expect(api.updateSiteInquiry).toHaveBeenCalledWith('21', { suspect: false }));
    expect(await screen.findByText("Ahmet Koç Yeni'ye taşındı.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Spam' }));
    await waitFor(() => expect(api.updateSiteInquiry).toHaveBeenCalledWith('20', { status: 'spam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Geri al' }));
    await waitFor(() => expect(api.updateSiteInquiry).toHaveBeenCalledWith('20', { status: 'new' }));
  });
});
