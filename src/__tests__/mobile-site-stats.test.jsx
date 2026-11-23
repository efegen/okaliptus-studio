import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MobileSiteStats } from '../mobile/siteStats/MobileSiteStats';
import { MobileSiteLive } from '../mobile/siteStats/MobileSiteLive';
import { InquiryOriginCard } from '../mobile/siteStats/InquiryOriginCard';
import { MobileMenu } from '../mobile/MobileMenu';
import {
  changeText,
  duration,
  funnelFor,
  inquiryKindsText,
  percent,
  rangeLabel,
  sourceLine,
  sourceMeta,
} from '../mobile/siteStats/siteStatsMeta';
import { can, canSeePage } from '../permissions';
import * as api from '../api';

vi.mock('../api', () => ({
  getSiteStatsOverview: vi.fn(),
  getSiteStatsLive: vi.fn(),
}));

function overview(overrides = {}) {
  return {
    period: '7d',
    days: 7,
    range: { from: '2026-11-17', to: '2026-11-23' },
    totals: {
      visitors: 412,
      visits: 430,
      pageviews: 1180,
      avgVisitMs: 134000,
      previousVisitors: 349,
      inquiries: 9,
      inquiriesByKind: { camp: 6, lesson: 2, contact: 1 },
    },
    series: [48, 52, 61, 44, 70, 78, 59].map((visitors, i) => ({ day: `2026-11-${17 + i}`, visitors, pageviews: visitors * 3 })),
    pages: [
      { path: '/etkinlikler/pamukkale-yoga-kampi', title: 'Pamukkale Yoga Kampı', views: 486, visits: 301, avgActiveMs: 185000, avgScroll: 61, sections: { program: 240, giris: 174 } },
      { path: '/', title: 'Ana sayfa', views: 322, visits: 280, avgActiveMs: 70000, avgScroll: 40, sections: {} },
      { path: '/dersler', title: 'Birebir dersler', views: 168, visits: 150, avgActiveMs: 140000, avgScroll: 55, sections: { form: 60 } },
    ],
    regions: [
      { region: 'İzmir', visitors: 214 },
      { region: 'İstanbul', visitors: 71 },
      { region: null, visitors: 12 },
    ],
    devices: [{ device: 'phone', visitors: 354 }, { device: 'desktop', visitors: 50 }, { device: 'tablet', visitors: 8 }],
    speed: [{ device: 'phone', lcpMs: 1400, samples: 300 }],
    sources: [
      { source: 'instagram_ad', visitors: 168, visits: 170, avgVisitMs: 148000, inquiries: 4, topPath: '/etkinlikler/pamukkale-yoga-kampi', topTitle: 'Pamukkale Yoga Kampı' },
      { source: 'instagram', visitors: 96, visits: 99, avgVisitMs: 112000, inquiries: 2, topPath: '/', topTitle: 'Ana sayfa' },
      { source: 'google', visitors: 74, visits: 80, avgVisitMs: 125000, inquiries: 2, topPath: '/dersler', topTitle: 'Birebir dersler' },
      { source: 'chatgpt', visitors: 11, visits: 11, avgVisitMs: 96000, inquiries: 0, topPath: '/dersler', topTitle: 'Birebir dersler' },
    ],
    links: [
      { source: 'instagram', label: 'biyografi', clickMark: true, visitors: 61 },
      { source: 'instagram', label: null, clickMark: true, visitors: 8 },
    ],
    ads: [
      {
        source: 'instagram_ad', campaign: 'Pamukkale Kampı', content: 'Video 2', visitors: 97, visits: 98, avgVisitMs: 171000,
        formOpen: 14, formStart: 9, formSubmit: 3, inquiries: 3,
        regions: [{ region: 'İzmir', visitors: 52 }, { region: 'İstanbul', visitors: 21 }, { region: null, visitors: 4 }],
        sections: { giris: 61 },
      },
      {
        source: 'instagram_ad', campaign: 'Birebir dersler', content: 'Stüdyo', visitors: 15, visits: 15, avgVisitMs: 100000,
        formOpen: 0, formStart: 1, formSubmit: 0, inquiries: 0,
        regions: [{ region: 'İzmir', visitors: 11 }],
        sections: { form: 6 },
      },
    ],
    forms: { camp: { open: 41, start: 19, submit: 6, error: 0 }, lesson: { open: 0, start: 12, submit: 2, error: 1 } },
    events: [],
    crawlers: null,
    geo: { edition: 'dbip-city-lite-2026-11', attribution: 'IP Geolocation by DB-IP' },
    ...overrides,
  };
}

function liveData(overrides = {}) {
  return {
    count: 2,
    visitors: [
      {
        path: '/etkinlikler/pamukkale-yoga-kampi', title: 'Pamukkale Yoga Kampı', source: 'instagram_ad', referrerHost: null,
        campaign: 'Pamukkale Kampı', content: 'Video 2', clickMark: 'meta', region: 'İzmir', device: 'phone', browser: 'Instagram',
        startedAt: new Date().toISOString(), durationMs: 380000, formOpen: 'camp', trail: [],
      },
      {
        path: '/dersler', title: 'Birebir dersler', source: 'chatgpt', referrerHost: 'chatgpt.com',
        campaign: null, content: null, clickMark: null, region: null, device: 'desktop', browser: 'Chrome',
        startedAt: new Date().toISOString(), durationMs: 75000, formOpen: null, trail: [{ path: '/', title: 'Ana sayfa' }],
      },
    ],
    pages: [
      { path: '/etkinlikler/pamukkale-yoga-kampi', title: 'Pamukkale Yoga Kampı', count: 1 },
      { path: '/dersler', title: 'Birebir dersler', count: 1 },
    ],
    ...overrides,
  };
}

function wrap(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function Screen({ initialSection = 'ozet', initialPeriod = '7d', ...rest }) {
  const [section, setSection] = React.useState(initialSection);
  const [period, setPeriod] = React.useState(initialPeriod);
  return <MobileSiteStats period={period} section={section} onChangePeriod={setPeriod} onChangeSection={setSection} {...rest} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getSiteStatsOverview.mockResolvedValue(overview());
  api.getSiteStatsLive.mockResolvedValue(liveData());
});

describe('Site ekranı yardımcıları', () => {
  it('süreyi okunur yazar', () => {
    expect(duration(48000)).toBe('48 sn');
    expect(duration(134000)).toBe('2 dk 14 sn');
    expect(duration(185000)).toBe('3 dk 05 sn');
    expect(duration(120000)).toBe('2 dk');
    expect(duration(3900000)).toBe('1 sa 5 dk');
    expect(duration(undefined)).toBe('0 sn');
  });

  it('yüzde sıfırdan büyükse en az 1 olur', () => {
    expect(percent(174, 301)).toBe(58);
    expect(percent(1, 1000)).toBe(1);
    expect(percent(0, 50)).toBe(0);
    expect(percent(5, 0)).toBe(0);
  });

  it('önceki döneme göre değişimi yazar; karşılaştıracak veri yoksa susar', () => {
    expect(changeText(412, 349, '7d')).toEqual({ text: 'Önceki 7 günden %18 fazla', tone: 'up' });
    expect(changeText(50, 100, 'today')).toEqual({ text: 'Dünden %50 az', tone: 'down' });
    expect(changeText(40, 0, '30d')).toBeNull();
  });

  it('tarih aralığı ve form dökümü', () => {
    expect(rangeLabel('2026-11-17', '2026-11-23')).toBe('17–23 Kasım');
    expect(rangeLabel('2026-10-25', '2026-11-23')).toBe('25 Ekim – 23 Kasım');
    expect(inquiryKindsText({ camp: 6, lesson: 2, contact: 1 })).toBe('6 ön kayıt, 2 ders, 1 mesaj');
    expect(inquiryKindsText({})).toBe('');
  });

  it('kaynak adları ve canlı satırı', () => {
    expect(sourceMeta('instagram_ad').label).toBe('Instagram reklamı');
    expect(sourceMeta('bilinmeyen-kaynak').label).toBe('bilinmeyen-kaynak');
    expect(sourceLine({ source: 'instagram_ad', campaign: 'Kamp', content: 'Video 2' })).toBe('Instagram reklamı: Kamp, Video 2');
    expect(sourceLine({ source: 'chatgpt' })).toBe('ChatGPT cevabındaki bağlantıdan');
    expect(sourceLine({ source: 'other', referrerHost: 'ornek.com' })).toBe('ornek.com');
    expect(sourceLine({ source: 'direct' })).toBe('Adresi yazarak geldi');
  });

  it('form yolunu sayfa, bölüm ve form adımlarından kurar', () => {
    const camp = funnelFor(overview(), 'camp');
    expect(camp.steps.map((s) => [s.label, s.value])).toEqual([
      ['Sayfayı açan', 301], ['Fiyatı gören', 174], ['Formu açan', 41], ['Yazmaya başlayan', 19], ['Ön kayıt gönderen', 6],
    ]);
    const lesson = funnelFor(overview(), 'lesson');
    expect(lesson.steps.map((s) => s.value)).toEqual([150, 60, 12, 2]);
    expect(funnelFor(overview({ pages: [] }), 'camp')).toBeNull();
  });
});

describe('Yetki: Site ekranı yalnız owner', () => {
  it('yetki matrisi ve sayfa kapısı', () => {
    expect(can('owner', 'site.stats.read')).toBe(true);
    for (const role of ['admin', 'instructor', 'assistant']) {
      expect(can(role, 'site.stats.read')).toBe(false);
      expect(canSeePage(role, 'site-stats')).toBe(false);
      expect(canSeePage(role, 'site-live')).toBe(false);
    }
    expect(canSeePage('owner', 'site-stats')).toBe(true);
  });

  it('menüde "Site" satırını yalnız owner görür', () => {
    const onNavigate = vi.fn();
    const { unmount } = render(<MobileMenu user={{ displayName: 'Efe', role: 'owner' }} onNavigate={onNavigate} onLogout={() => {}} />);
    fireEvent.click(screen.getByText('Site').closest('button'));
    expect(onNavigate).toHaveBeenCalledWith('site-stats');
    unmount();
    render(<MobileMenu user={{ displayName: 'Ceren', role: 'admin' }} onNavigate={onNavigate} onLogout={() => {}} />);
    expect(screen.queryByText('Site')).toBeNull();
  });
});

describe('Site ekranı', () => {
  it('özet: canlı kart, ana sayılar, sayfalar, iller, form yolu', async () => {
    const onOpenLive = vi.fn();
    wrap(<Screen onOpenLive={onOpenLive} onBack={() => {}} />);

    expect(await screen.findByText('Sayfa görüntüleme')).toBeInTheDocument();
    expect(api.getSiteStatsOverview).toHaveBeenCalledWith('7d');
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText('Önceki 7 günden %18 fazla')).toBeInTheDocument();
    expect(screen.getByText('Kişi başı 2,9 sayfa')).toBeInTheDocument();
    expect(screen.getByText('2 dk 14 sn')).toBeInTheDocument();
    expect(screen.getByText('6 ön kayıt, 2 ders, 1 mesaj')).toBeInTheDocument();

    const liveCard = await screen.findByRole('button', { name: /Şu an sitede 2 kişi/ });
    expect(within(liveCard).getByText('1 kişi reklamdan geldi')).toBeInTheDocument();
    fireEvent.click(liveCard);
    expect(onOpenLive).toHaveBeenCalled();

    expect(screen.getByText("Ortalama 3 dk 05 sn, yüzde 58'i fiyat bölümüne indi")).toBeInTheDocument();
    expect(screen.getByText('İzmir')).toBeInTheDocument();
    expect(screen.getByText('Bilinmiyor ya da yurt dışı')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Telefon yüzde 86/ })).toBeInTheDocument();
    expect(screen.getByText('Ön kayıt yolu')).toBeInTheDocument();
    expect(screen.getByText('Ön kayıt gönderen')).toBeInTheDocument();
    expect(screen.getByText(/telefonda 1,4 saniyede açılıyor/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'IP Geolocation by DB-IP' })).toHaveAttribute('href', 'https://db-ip.com');
  });

  it('dönem değişince yeni dönem istenir', async () => {
    wrap(<Screen onOpenLive={() => {}} onBack={() => {}} />);
    await screen.findByText('Sayfa görüntüleme');
    fireEvent.click(screen.getByRole('button', { name: '30 gün' }));
    await waitFor(() => expect(api.getSiteStatsOverview).toHaveBeenCalledWith('30d'));
    expect(screen.getByRole('button', { name: '30 gün' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('kaynaklar: en çok form getiren, liste ve Instagram bağlantıları', async () => {
    wrap(<Screen initialSection="kaynaklar" onOpenLive={() => {}} onBack={() => {}} />);
    expect(await screen.findByText('En çok form buradan geldi: Instagram reklamı')).toBeInTheDocument();
    expect(screen.getByText("9 formun 4'i")).toBeInTheDocument();
    expect(screen.getByText('Instagram profili ve hikâyeler')).toBeInTheDocument();
    expect(screen.getByText('Ortalama 2 dk 28 sn, 4 form')).toBeInTheDocument();
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('biyografi')).toBeInTheDocument();
    expect(screen.getByText('Etiketsiz bağlantı')).toBeInTheDocument();
  });

  it('reklamlar: özet, reklam kartları, etiketsiz tıklamalar ve etiket satırı', async () => {
    wrap(<Screen initialSection="reklamlar" onOpenLive={() => {}} onBack={() => {}} />);
    expect(await screen.findByText('Reklamlardan gelenler')).toBeInTheDocument();
    expect(screen.getByText('Her 37 ziyaretçiden biri form bıraktı.')).toBeInTheDocument();

    const video = screen.getByRole('heading', { name: 'Video 2' }).closest('section');
    expect(within(video).getByText('Instagram reklamı, Pamukkale Kampı')).toBeInTheDocument();
    expect(within(video).getByText('fiyatı gördü')).toBeInTheDocument();
    expect(within(video).getByText('61')).toBeInTheDocument();
    expect(within(video).getByText('formu açtı')).toBeInTheDocument();
    expect(within(video).getByText('İzmir 52, İstanbul 21, diğer 24')).toBeInTheDocument();

    const studio = screen.getByRole('heading', { name: 'Stüdyo' }).closest('section');
    expect(within(studio).getByText('forma indi')).toBeInTheDocument();
    expect(within(studio).getByText('yazmaya başladı')).toBeInTheDocument();

    expect(screen.getByText('8 etiketsiz Instagram tıklaması')).toBeInTheDocument();
    expect(screen.getByText(/utm_medium=paid/)).toBeInTheDocument();
  });

  it('reklam yoksa nasıl etiketleneceğini anlatır', async () => {
    api.getSiteStatsOverview.mockResolvedValue(overview({ ads: [], links: [] }));
    wrap(<Screen initialSection="reklamlar" onOpenLive={() => {}} onBack={() => {}} />);
    expect(await screen.findByText('Bu dönemde reklamdan gelen yok')).toBeInTheDocument();
    expect(screen.queryByText('Reklamlardan gelenler')).toBeNull();
    expect(screen.getByRole('button', { name: 'Satırı kopyala' })).toBeInTheDocument();
  });

  it('yapay zekâ: gelen olmayanlar da listelenir, bot okumaları yokken söylenir', async () => {
    wrap(<Screen initialSection="yapay-zeka" onOpenLive={() => {}} onBack={() => {}} />);
    expect(await screen.findByText('11 kişi')).toBeInTheDocument();
    expect(screen.getByText('En çok açılan: Birebir dersler')).toBeInTheDocument();
    for (const name of ['ChatGPT', 'Perplexity', 'Gemini', 'Claude']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText('Copilot')).toBeNull();
    expect(screen.getAllByText('Bu dönemde gelen olmadı')).toHaveLength(3);
    expect(screen.getByText(/henüz burada gösterilmiyor/)).toBeInTheDocument();
    expect(screen.queryByText('Siteyi okuyan yapay zekâlar')).toBeNull();
  });

  it('hata olursa yeniden deneme sunar', async () => {
    api.getSiteStatsOverview.mockRejectedValue(new Error('yok'));
    wrap(<Screen onOpenLive={() => {}} onBack={() => {}} />);
    expect(await screen.findByText('İstatistikler alınamadı.')).toBeInTheDocument();
    api.getSiteStatsOverview.mockResolvedValue(overview());
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('Sayfa görüntüleme')).toBeInTheDocument();
  });
});

describe('Şu an sitede', () => {
  it('ziyaretçileri kaynak, il, cihaz, süre ve açık formla listeler', async () => {
    wrap(<MobileSiteLive onBack={() => {}} />);
    expect(await screen.findByText('2 kişi')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Pamukkale Yoga Kampı')).toBeInTheDocument();
    expect(within(rows[0]).getByText('İzmir, telefon')).toBeInTheDocument();
    expect(within(rows[0]).getByText('6 dk 20 sn')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Instagram reklamı: Pamukkale Kampı, Video 2')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Ön kayıt formu açık')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Bilgisayar')).toBeInTheDocument();
    expect(within(rows[1]).getByText('ChatGPT cevabındaki bağlantıdan. Önce: Ana sayfa')).toBeInTheDocument();
  });

  it('kimse yokken boş durumu gösterir', async () => {
    api.getSiteStatsLive.mockResolvedValue({ count: 0, visitors: [], pages: [] });
    wrap(<MobileSiteLive onBack={() => {}} />);
    expect(await screen.findByText('Şu an sitede kimse yok')).toBeInTheDocument();
  });
});

describe('Talep detayında kaynak kartı', () => {
  it('ziyaret özeti varsa kaynağı, ili, süreyi ve gezilen sayfaları yazar', () => {
    render(
      <InquiryOriginCard
        origin={{
          source: 'instagram_ad', campaign: 'Pamukkale Kampı', content: 'Video 2', region: 'İzmir', device: 'phone', durationMs: 380000,
          pages: [{ path: '/etkinlikler/pamukkale-yoga-kampi', title: 'Pamukkale Yoga Kampı', activeMs: 130000 }, { path: '/galeri', title: null, activeMs: 55000 }],
        }}
      />,
    );
    expect(screen.getByText('Siteye nereden geldi?')).toBeInTheDocument();
    expect(screen.getByText('Instagram reklamı')).toBeInTheDocument();
    expect(screen.getByText('Pamukkale Kampı, Video 2')).toBeInTheDocument();
    expect(screen.getByText('İzmir')).toBeInTheDocument();
    expect(screen.getByText('6 dk 20 sn')).toBeInTheDocument();
    expect(screen.getByText('1. Pamukkale Yoga Kampı')).toBeInTheDocument();
    expect(screen.getByText('2. /galeri')).toBeInTheDocument();
  });

  it('ziyaret özeti yoksa hiçbir şey çizmez', () => {
    const { container } = render(<InquiryOriginCard origin={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
