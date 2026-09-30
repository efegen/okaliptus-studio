import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as api from '../api';
import * as push from '../push';
import { MobilePushPrompt } from '../mobile/MobilePushPrompt';

vi.mock('../api', () => ({
  getPushConfig: vi.fn(),
}));

vi.mock('../push', () => ({
  pushSupported: vi.fn(() => true),
  getCurrentSubscription: vi.fn(async () => null),
  enablePush: vi.fn(async () => true),
}));

describe('MobilePushPrompt — açılış bildirim izni ekranı', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPushConfig.mockResolvedValue({ vapidPublicKey: 'k' });
    push.pushSupported.mockReturnValue(true);
    push.getCurrentSubscription.mockResolvedValue(null);
    globalThis.Notification = { permission: 'default' };
  });

  it('abonelik yoksa tam sayfa gelir; izin verince kapanır', async () => {
    const onEnabled = vi.fn();
    render(<MobilePushPrompt onEnabled={onEnabled} />);
    expect(await screen.findByRole('dialog', { name: 'Bildirimleri aç' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bildirimlere izin ver' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    expect(onEnabled).toHaveBeenCalledTimes(1);
  });

  it('bu cihazda abonelik varsa hiç görünmez', async () => {
    push.getCurrentSubscription.mockResolvedValue({ endpoint: 'e' });
    render(<MobilePushPrompt />);
    await waitFor(() => expect(push.getCurrentSubscription).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Şimdi değil" bu açılış için kapatır', async () => {
    render(<MobilePushPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Şimdi değil' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(push.enablePush).not.toHaveBeenCalled();
  });

  it('izin verilmezse hata gösterir, ekran açık kalır', async () => {
    push.enablePush.mockRejectedValueOnce(new Error('Bildirim izni verilmedi.'));
    render(<MobilePushPrompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bildirimlere izin ver' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bildirim izni verilmedi.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('izin önceden reddedildiyse telefon ayarlarını tarif eder', async () => {
    globalThis.Notification = { permission: 'denied' };
    render(<MobilePushPrompt />);
    expect(await screen.findByRole('dialog', { name: 'Bildirim izni kapalı' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
  });

  it('push desteklenmiyor ya da yapılandırılmamışsa çıkmaz', async () => {
    push.pushSupported.mockReturnValue(false);
    const { unmount } = render(<MobilePushPrompt />);
    await waitFor(() => expect(api.getPushConfig).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    push.pushSupported.mockReturnValue(true);
    api.getPushConfig.mockRejectedValue(new Error('503'));
    render(<MobilePushPrompt />);
    await waitFor(() => expect(api.getPushConfig).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
