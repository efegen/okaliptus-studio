// Web Push istemci yardımcıları. Yalnız test kartı (settings.jsx) kullanır.
// Tüm sunucu çağrıları /push/* uçlarına gider ve test kullanıcısı kilidinin
// arkasındadır; yetkisiz hesap zaten 403 alır.

import { getPushConfig, subscribePush, unsubscribePush, sendTestPush } from './api';

// VAPID public key (base64url) → Uint8Array (applicationServerKey formatı).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// `ready` yerine getRegistration: SW hiç kayıtlı değilse (ör. `npm run dev`,
// PWA eklentisi dev'de SW kaydetmez) `ready` sonsuza dek bekler ve çağıran
// ekran hiç açılmaz; getRegistration hemen undefined döner → "abonelik yok".
export async function getCurrentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const SW_READY_TIMEOUT_MS = 10000;
const DEV_NO_SW_MSG =
  'Geliştirme sunucusunda (npm run dev) servis çalışanı yok; bildirim aboneliği yalnız build/preview ya da canlıda çalışır.';

// Aboneliğe SW gerekir; hiç gelmezse (kayıt başarısız) sonsuza dek beklemek
// yerine anlaşılır bir hatayla dön.
function waitForServiceWorker() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(import.meta.env.DEV ? DEV_NO_SW_MSG : 'Uygulama hazır değil. Sayfayı yenileyip tekrar dene.')),
        SW_READY_TIMEOUT_MS,
      );
    }),
  ]);
}

// İzin iste → mevcut SW'ye abone ol → endpoint'i sunucuya kaydet.
// İzin penceresi yalnız bu fonksiyon (yani buton dokunuşu) içinde açılır.
export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('Bu cihaz/tarayıcı bildirim desteklemiyor (iOS 16.4+ ve ana ekran PWA gerekir).');
  }

  // Dev'de SW yoksa izin penceresini boşuna açmadan hemen söyle.
  if (import.meta.env.DEV && !(await navigator.serviceWorker.getRegistration())) {
    throw new Error(DEV_NO_SW_MSG);
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Bildirim izni verilmedi.');
  }

  const cfg = await getPushConfig();
  if (!cfg?.vapidPublicKey) {
    throw new Error('Sunucu bildirim anahtarı yapılandırılmamış.');
  }

  const reg = await waitForServiceWorker();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  await subscribePush({
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return true;
}

export async function disablePush() {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  // Önce sunucu kaydını sil, sonra tarayıcı aboneliğini kapat.
  try {
    await unsubscribePush(sub.endpoint);
  } catch {
    // Sunucu silme başarısız olsa bile yerelden çıkmaya devam et.
  }
  await sub.unsubscribe();
}

export async function sendTest(delaySeconds = 0) {
  return sendTestPush(delaySeconds);
}
