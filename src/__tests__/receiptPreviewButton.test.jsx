/**
 * ReceiptPreviewButton — profil satırındaki "Makbuz" düğmesi artık doğrudan
 * paylaşmaz; önce önizleme modalını açar (ölçeklenmiş kart + altında paylaş
 * butonu). Rasterleyici/paylaşım mock'lanır (jsdom'da canvas yok).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { renderMock, shareMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  shareMock: vi.fn(),
}));

vi.mock('../receipt/renderReceiptToPng.js', () => ({ renderReceiptToPng: renderMock }));
vi.mock('../receipt/shareReceipt.js', () => ({
  shareReceipt: shareMock,
  receiptFilename: (m) => `Okaliptus-Makbuz-${m.receiptNo}.jpg`,
}));

import { ReceiptPreviewButton } from '../receipt/ReceiptPreviewButton.jsx';

const MODEL = {
  receiptNo: 'OK-2026-0418',
  customerName: 'Ayşe Kaya',
  dateText: '5 Haziran 2026',
  items: [{ name: 'Yoga Matı', desc: null, qty: 1, lineText: '850 TL', thumbSrc: null }],
  subtotalText: '850 TL',
  totalText: '850 TL',
  footerContact: '@okaliptusyoga · okaliptusyoga.com',
};

beforeEach(() => {
  renderMock.mockReset().mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  shareMock.mockReset().mockResolvedValue({ method: 'share' });
});

describe('ReceiptPreviewButton', () => {
  it('başta yalnız tetikleyici görünür, önizleme kapalı', () => {
    render(<ReceiptPreviewButton model={MODEL} />);
    expect(screen.getByRole('button', { name: 'Makbuz' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Ayşe Kaya')).not.toBeInTheDocument();
  });

  it('tıklayınca önizleme açılır: kart içeriği + paylaş butonu', async () => {
    render(<ReceiptPreviewButton model={MODEL} label="Makbuz" />);
    fireEvent.click(screen.getByRole('button', { name: 'Makbuz' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Ayşe Kaya')).toBeInTheDocument();
    expect(screen.getByText('OK-2026-0418')).toBeInTheDocument();
    // önizlemenin altında paylaş butonu (eager üretim tetiklenir)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Makbuzu paylaş/ })).toBeInTheDocument(),
    );
    expect(renderMock).toHaveBeenCalledWith(MODEL);
  });

  it('kapatınca önizleme kaybolur', async () => {
    render(<ReceiptPreviewButton model={MODEL} />);
    fireEvent.click(screen.getByRole('button', { name: 'Makbuz' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
