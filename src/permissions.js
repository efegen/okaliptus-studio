// Frontend yetki aynası — backend/src/auth/permissions.ts CAPABILITIES ile
// BİREBİR aynı matris tutulur. Bu KOZMETİKtir, GÜVENLİK DEĞİL: gerçek koruma
// sunucuda `requireCan` ile yapılır. Buradaki tek amaç, asistanın erişemeyeceği
// nav girişlerini / ekranları / kartları gizlemek — yoksa asistan tıklayınca
// kırık 403 ekranları görürdü. Backend matrisi değişirse burayı da güncelle.

const CAPABILITIES = {
  'users.manage': ['owner'],
  'push.test': ['owner'],
  'notifications.manage': ['owner'],
  'finance.read': ['owner', 'admin', 'instructor'],
  'movements.read': ['owner', 'admin', 'instructor'],
  'marketplace.manage': ['owner', 'admin', 'instructor'],
  'settings.manage': ['owner', 'admin', 'instructor'],
  'students.delete': ['owner', 'admin', 'instructor'],
  'audit.read': ['owner', 'admin', 'instructor'],
  'payments.delete': ['owner', 'admin', 'instructor'],
  'sales.delete': ['owner', 'admin', 'instructor'],
  'packages.delete': ['owner', 'admin', 'instructor'],
};

// Rol verilen yetkiye sahip mi? Rol tanımsız/bilinmeyense false (en kısıtlı).
export function can(role, capability) {
  const allowed = CAPABILITIES[capability];
  return Array.isArray(allowed) && allowed.includes(role);
}

// Sayfa → gereken yetki. Listede olmayan sayfalar herkese açık (home, students,
// calendar, products, product-sale(-checkout), occupancy, collect-payment ...).
export const PAGE_CAPABILITY = {
  settings: 'settings.manage',
  catalog: 'settings.manage', // "Dersler ve Eğitmenler" — katalog yönetimi
  movements: 'movements.read',
  finance: 'finance.read',
  orders: 'marketplace.manage',
  'order-detail': 'marketplace.manage',
  mapping: 'marketplace.manage',
};

// Rol verilen sayfayı görebilir mi? (haritada yoksa serbest)
export function canSeePage(role, page) {
  const cap = PAGE_CAPABILITY[page];
  return cap ? can(role, cap) : true;
}

// Rol → Türkçe UI etiketi (settings-users.jsx ile aynı sözlük).
export const ROLE_LABELS = {
  owner: 'Geliştirici',
  admin: 'Yönetici',
  instructor: 'Yönetici-Eğitmen',
  assistant: 'Asistan',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? 'Kullanıcı';
}
