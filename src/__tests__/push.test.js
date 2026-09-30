import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enablePush, getCurrentSubscription } from '../push';

vi.mock('../api', () => ({
  getPushConfig: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
  sendTestPush: vi.fn(),
}));

// SW hiç kayıtlı değil (npm run dev): `ready` asla çözülmez.
function installNoServiceWorker() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: new Promise(() => {}), getRegistration: vi.fn(async () => undefined) },
  });
  window.PushManager = function PushManager() {};
  window.Notification = { permission: 'default', requestPermission: vi.fn(async () => 'granted') };
}

describe('push — servis çalışanı yokken', () => {
  beforeEach(installNoServiceWorker);
  afterEach(() => {
    delete navigator.serviceWorker;
    delete window.PushManager;
    delete window.Notification;
  });

  it('getCurrentSubscription beklemeden null döner', async () => {
    await expect(getCurrentSubscription()).resolves.toBeNull();
  });

  it('enablePush izin penceresi açmadan anlaşılır hata verir (dev)', async () => {
    await expect(enablePush()).rejects.toThrow('servis çalışanı yok');
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });
});
