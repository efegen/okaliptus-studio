import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as api from '../api';
import * as push from '../push';
import { MobileMenu } from '../mobile/MobileMenu';

vi.mock('../api', () => ({
  getPushConfig: vi.fn(),
}));

vi.mock('../push', () => ({
  pushSupported: vi.fn(() => true),
  getCurrentSubscription: vi.fn(async () => null),
  enablePush: vi.fn(async () => true),
  disablePush: vi.fn(async () => {}),
}));

function renderMenu(role) {
  return render(
    <MobileMenu user={{ displayName: 'Ada', role }} onNavigate={() => {}} onLogout={() => {}} />,
  );
}

describe('MobileMenu — bildirim izni satırı', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPushConfig.mockResolvedValue({ vapidPublicKey: 'k' });
    globalThis.Notification = { permission: 'default' };
  });

  it('asistan menüden bu cihazda bildirimleri açabilir', async () => {
    renderMenu('assistant');
    const toggle = await screen.findByRole('switch', { name: 'Bu cihazda bildirimler' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Bu cihazda kapalı')).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Bu cihazda açık')).toBeInTheDocument();
  });

  it('izin reddedildiyse hatayı gösterir, anahtar kapalı kalır', async () => {
    push.enablePush.mockRejectedValueOnce(new Error('Bildirim izni verilmedi.'));
    renderMenu('assistant');
    const toggle = await screen.findByRole('switch', { name: 'Bu cihazda bildirimler' });
    fireEvent.click(toggle);
    expect(await screen.findByText('Bildirim izni verilmedi.')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('push yapılandırılmamışsa satır gizlenir', async () => {
    api.getPushConfig.mockRejectedValue(new Error('503'));
    renderMenu('assistant');
    await waitFor(() => expect(api.getPushConfig).toHaveBeenCalled());
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('Ayarlar\'ı gören roller satırı menüde görmez (kart Ayarlar\'da)', () => {
    renderMenu('admin');
    expect(screen.queryByText('Bildirimlere izin ver')).not.toBeInTheDocument();
    expect(api.getPushConfig).not.toHaveBeenCalled();
  });
});
