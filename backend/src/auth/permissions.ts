// RBAC: dört sabit rol, DB-tabanlı rol/izin tablosu yok (solo geliştirici,
// rol seti nadiren değişir). Asistan kısıtları CAPABILITIES'e satır eklenerek
// gelir (Etap 2) — router'lar `requireCan(...)` ile kapılanır, iş mantığı aynı.
export const ROLES = ['owner', 'admin', 'instructor', 'assistant'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

const CAPABILITIES = {
  // Owner-only (Etap 1): kullanıcı yönetimi + deploy-test push.
  'users.manage': ['owner'],
  'push.test': ['owner'],
  'notifications.manage': ['owner'], // bildirim ayar modülü (kim ne bildirim alır)
  'events.delete': ['owner'], // geri alınamaz etkinlik silme + yeniden doğrulama

  // Etap 2 — asistan kısıtları. owner/admin/instructor bu fazda aynı veri
  // erişimine sahip; tek dışlanan rol assistant. Yeni bir yetkiyi asistana
  // açmak = ilgili satıra 'assistant' eklemek (router değişmez).
  'finance.read': ['owner', 'admin', 'instructor'], // finansal KPI / ciro / akış
  'movements.read': ['owner', 'admin', 'instructor'], // stüdyo geneli hareket akışı
  'marketplace.manage': ['owner', 'admin', 'instructor'], // pazaryeri (channels/trendyol/mapping)
  'settings.manage': ['owner', 'admin', 'instructor'], // ayarlar + katalog (eğitmen/ders türü) yazma
  'students.delete': ['owner', 'admin', 'instructor'], // öğrenci kalıcı silme
  'audit.read': ['owner', 'admin', 'instructor'], // etkinlik/denetim kayıtları
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}
