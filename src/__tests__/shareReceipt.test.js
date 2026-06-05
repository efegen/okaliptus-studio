/**
 * shareReceipt — Web Share API + indirme fallback dal testleri.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { shareReceipt, receiptFilename } from '../receipt/shareReceipt.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function pngBlob() {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
}

describe('receiptFilename', () => {
  it('makbuz numarasından dosya adı üretir', () => {
    expect(receiptFilename({ receiptNo: 'OK-2026-0418' })).toBe('Okaliptus-Makbuz-OK-2026-0418.png');
  });
});

describe('shareReceipt', () => {
  it('Web Share destekliyse PNG dosyasını paylaşır', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });

    const res = await shareReceipt(pngBlob(), 'Okaliptus-Makbuz-OK-2026-0418.png', { title: 'T', text: 'X' });

    expect(res).toEqual({ method: 'share' });
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0];
    expect(Array.isArray(arg.files)).toBe(true);
    expect(arg.files[0]).toBeInstanceOf(File);
    expect(arg.files[0].name).toBe('Okaliptus-Makbuz-OK-2026-0418.png');
    expect(arg.files[0].type).toBe('image/png');
    expect(arg.title).toBe('T');
    expect(arg.text).toBe('X');
  });

  it('Web Share yoksa dosyayı indirir', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {}); // canShare/share yok
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const res = await shareReceipt(pngBlob(), 'dosya.png');

    expect(res).toEqual({ method: 'download' });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('kullanıcı paylaşımı iptal ederse (AbortError) indirme yapmaz', async () => {
    const abort = Object.assign(new Error('iptal'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    const res = await shareReceipt(pngBlob(), 'dosya.png');

    expect(res).toEqual({ method: 'cancelled' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
