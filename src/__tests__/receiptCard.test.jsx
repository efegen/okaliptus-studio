/**
 * ReceiptCard — model alanlarını ve thumbnail/placeholder ayrımını render
 * ettiğini doğrular (piksel/rasterize testi DEĞİL; jsdom'da canvas yok).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceiptCard } from '../receipt/ReceiptCard.jsx';

const MODEL = {
  receiptNo: 'OK-2026-0418',
  customerName: 'Ayşe Kaya',
  dateText: '5 Haziran 2026',
  timeText: '15:00',
  items: [
    { name: 'Yoga Matı', desc: null, qty: 1, lineText: '850,00 TL', thumbSrc: null },
    { name: 'Blok', desc: null, qty: 2, lineText: '560,00 TL', thumbSrc: 'data:image/png;base64,AAAA' },
  ],
  subtotalText: '1.410,00 TL',
  totalText: '1.410,00 TL',
  footerContact: '@okaliptusyoga · okaliptusyoga.com',
};

describe('ReceiptCard', () => {
  it('başlık, kalem ve toplam alanlarını render eder', () => {
    render(<ReceiptCard model={MODEL} />);
    expect(screen.getByText('OK-2026-0418')).toBeInTheDocument();
    expect(screen.getByText('Ayşe Kaya')).toBeInTheDocument();
    expect(screen.getByText('5 Haziran 2026')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    expect(screen.getByText('Yoga Matı')).toBeInTheDocument();
    expect(screen.getByText('Blok')).toBeInTheDocument();
    expect(screen.getByText('850,00 TL')).toBeInTheDocument();
    expect(screen.getAllByText('1.410,00 TL')).toHaveLength(2); // ara toplam + toplam
    expect(screen.getByText(/okaliptusyoga/)).toBeInTheDocument();
  });

  it('görseli olan kalemde img, olmayanda bej placeholder gösterir', () => {
    const { container } = render(<ReceiptCard model={MODEL} />);
    expect(container.querySelectorAll('img.rcpt-thumb')).toHaveLength(1);
    expect(container.querySelectorAll('.rcpt-thumb-ph')).toHaveLength(1);
  });
});
