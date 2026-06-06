/**
 * Makbuz modeli — saf çekirdek testleri (TZ-bağımsız tutuldu).
 *
 * fmtReceiptTL/Date, receiptNo ve iki giriş şeklinin (cart + profil items[])
 * tek normalize modele indirgenmesi.
 */
import { describe, it, expect } from 'vitest';
import {
  fmtReceiptTL,
  fmtReceiptDate,
  fmtReceiptTime,
  receiptNo,
  buildModelFromCart,
  buildModelFromSale,
} from '../receipt/buildReceiptModel.js';

describe('fmtReceiptTL', () => {
  it('her zaman iki ondalık + " TL" ile basar (formal belge)', () => {
    expect(fmtReceiptTL(4640)).toBe('4.640,00 TL');
    expect(fmtReceiptTL('850')).toBe('850,00 TL');
    expect(fmtReceiptTL(0)).toBe('0,00 TL');
  });
  it('kuruşu virgülle iki haneye tamamlar', () => {
    expect(fmtReceiptTL(125.5)).toBe('125,50 TL');
    expect(fmtReceiptTL('1410.00')).toBe('1.410,00 TL');
  });
  it('geçersiz değeri 0,00 sayar', () => {
    expect(fmtReceiptTL(null)).toBe('0,00 TL');
    expect(fmtReceiptTL('abc')).toBe('0,00 TL');
  });
});

describe('fmtReceiptDate', () => {
  it('uzun Türkçe tarih üretir', () => {
    // Ay ortası → TZ kaymasında bile "Haziran 2026".
    expect(fmtReceiptDate('2026-06-15T12:00:00.000Z')).toMatch(/^\d{1,2} Haziran 2026$/);
  });
  it('geçersiz tarihte boş döner', () => {
    expect(fmtReceiptDate('not-a-date')).toBe('');
  });
});

describe('fmtReceiptTime', () => {
  it('Europe/Istanbul saatini 24-saat üretir', () => {
    // 12:00 UTC → Istanbul (UTC+3) → 15:00. TZ sabit olduğu için deterministik.
    expect(fmtReceiptTime('2026-06-15T12:00:00.000Z')).toBe('15:00');
  });
  it('geçersiz tarihte boş döner', () => {
    expect(fmtReceiptTime('not-a-date')).toBe('');
  });
});

describe('receiptNo', () => {
  it('OK-<yıl>-<4 hane> üretir', () => {
    expect(receiptNo(418, '2026-06-15T12:00:00.000Z')).toBe('OK-2026-0418');
  });
  it('id sıfırla doldurulur, sayısal olmayan karakter ayıklanır', () => {
    expect(receiptNo(7, '2026-06-15T12:00:00.000Z')).toBe('OK-2026-0007');
    expect(receiptNo('12', '2026-06-15T12:00:00.000Z')).toBe('OK-2026-0012');
  });
});

describe('buildModelFromCart', () => {
  const cart = new Map([
    ['a', { product: { id: 5, name: 'Yoga Matı', price: '850', image_url: 'https://api.example.com/products/5/image?v=1', category: 'Mat' }, quantity: 1 }],
    ['b', { product: { id: 6, name: 'Blok', price: '280', image_url: null }, quantity: 2 }],
  ]);
  const model = buildModelFromCart({ cart, student: { full_name: 'Ayşe Kaya' }, saleId: 418, soldAt: '2026-06-15T12:00:00.000Z' });

  it('başlık alanlarını doldurur', () => {
    expect(model.receiptNo).toBe('OK-2026-0418');
    expect(model.customerName).toBe('Ayşe Kaya');
    expect(model.dateText).toMatch(/Haziran 2026$/);
    expect(model.timeText).toBe('15:00');
    expect(model.footerContact).toMatch(/okaliptusyoga/);
  });

  it('kalemleri fiyat×adet ile haritalar', () => {
    expect(model.items).toHaveLength(2);
    expect(model.items[0]).toMatchObject({ name: 'Yoga Matı', qty: 1, lineText: '850,00 TL' });
    expect(model.items[0].thumbSrc).toBe('https://api.example.com/products/5/image?v=1');
    expect(model.items[1]).toMatchObject({ name: 'Blok', qty: 2, lineText: '560,00 TL', thumbSrc: null });
  });

  it('açıklama satırını (kategori) bilinçli olarak atlar', () => {
    expect(model.items[0].desc).toBeNull();
  });

  it('ara toplam = toplam (indirim yok)', () => {
    expect(model.totalText).toBe('1.410,00 TL'); // 850 + 280×2
    expect(model.subtotalText).toBe(model.totalText);
  });
});

describe('buildModelFromSale', () => {
  const sale = {
    product_sale_id: 7,
    sold_at: '2026-06-15T12:00:00.000Z',
    total_amount: '125.50',
    items: [
      { name_snapshot: 'Tişört', unit_price_snapshot: '125.50', quantity: 1, line_total: '125.50', image_url: '/products/9/image', product_id: 9 },
    ],
  };
  const model = buildModelFromSale({ sale, student: { full_name: 'Mehmet' } });

  it('snapshot kalemlerinden modeli kurar', () => {
    expect(model.receiptNo).toBe('OK-2026-0007');
    expect(model.customerName).toBe('Mehmet');
    expect(model.timeText).toBe('15:00');
    expect(model.items).toHaveLength(1);
    expect(model.items[0]).toMatchObject({ name: 'Tişört', qty: 1, lineText: '125,50 TL', thumbSrc: '/products/9/image' });
  });

  it('toplamı total_amount alanından alır', () => {
    expect(model.totalText).toBe('125,50 TL');
    expect(model.subtotalText).toBe('125,50 TL');
  });

  it('items yoksa boş kalem listesi döner', () => {
    const m = buildModelFromSale({ sale: { product_sale_id: 1, sold_at: '2026-06-15T12:00:00.000Z', total_amount: '0' }, student: { full_name: 'X' } });
    expect(m.items).toEqual([]);
  });
});
