/**
 * ReceiptShareButton — render+share zincirini bağladığını doğrular.
 * Rasterleyici ve paylaşım util'i mock'lanır (jsdom'da canvas/foreignObject yok).
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
  receiptFilename: (m) => `Okaliptus-Makbuz-${m.receiptNo}.png`,
}));

import { ReceiptShareButton } from '../receipt/ReceiptShareButton.jsx';

const MODEL = { receiptNo: 'OK-2026-0001', customerName: 'Ayşe', totalText: '850 TL', items: [] };

beforeEach(() => {
  renderMock.mockReset().mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  shareMock.mockReset().mockResolvedValue({ method: 'share' });
});

describe('ReceiptShareButton', () => {
  it('tıklayınca makbuzu üretip paylaşır', async () => {
    render(<ReceiptShareButton model={MODEL} label="Makbuzu paylaş" />);
    const btn = screen.getByRole('button', { name: /Makbuzu paylaş/ });

    fireEvent.click(btn);

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(renderMock).toHaveBeenCalledWith(MODEL);
    const [blobArg, fileNameArg] = shareMock.mock.calls[0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(fileNameArg).toBe('Okaliptus-Makbuz-OK-2026-0001.png');
  });

  it('üretim başarısızsa hata durumuna geçer ve tekrar denenebilir', async () => {
    renderMock.mockReset().mockRejectedValueOnce(new Error('patladı'));
    render(<ReceiptShareButton model={MODEL} label="Makbuzu paylaş" />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Tekrar dene'));
    expect(shareMock).not.toHaveBeenCalled();
  });
});
