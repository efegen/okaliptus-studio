// v1.6 — Trendyol kargo firması değişikliği TAKİBİ (süreç-içi kayıt).
//
// Sorun: PUT cargo-providers 200 dönse de TY değişikliği ASENKRON uygular; getOrders
// bir süre ESKİ firmayı döndürür (TY dokümanı: "kargo değişiminden sonra paketi
// tekrar çekerek kontrol edin"). Takip olmadan ekran eski firmayı sessizce gösterir
// ve operatör değişikliğin gidip gitmediğini bilemez.
//
// Her başarılı PUT için paket başına bir kayıt tutulur. Durum SAKLANMAZ; siparişin
// elimizdeki en taze TY verisinden her okumada TÜRETİLİR:
//   pending     → TY henüz yeni firmayı döndürmüyor (onay bekleniyor)
//   applied     → TY yeni firmayı döndürüyor (ilk görülme anı appliedAt'e yapışır)
//   unconfirmed → CONFIRM_TIMEOUT içinde yansımadı; operatör TY panelinden kontrol
//                 etmeli (ör. TEX kotası doluysa TY isteği sessizce geçersiz sayar).
//
// Kasıtlı olarak DB'ye yazılmaz (orders.service snapshot önbelleği gibi tek, uzun
// ömürlü Railway sürecine dayanır). Yeniden başlatmada kayıtlar düşer → ekran TY'nin
// döndürdüğünü gösterir (yanlış değil; yalnız "bekleniyor" bilgisi kaybolur).

import type { DisplayOrder } from "./orders.service.js";
import { cargoProviderCodeFromName, foldCargoName } from "./cargo-providers.js";

// Bu süre içinde yansımayan değişiklik "unconfirmed" sayılır.
export const CARGO_CHANGE_CONFIRM_TIMEOUT_MS = 10 * 60_000;
// Uygulanan değişiklik ekranda bu süre "güncellendi" olarak görünür.
const APPLIED_VISIBLE_MS = 2 * 60_000;
// Sonuçsuz kayıtlar en fazla bu kadar tutulur.
const RETENTION_MS = 60 * 60_000;

export type CargoChangeStatus = "pending" | "applied" | "unconfirmed";

// Liste/durum yanıtlarında siparişe iliştirilen görünüm (DisplayOrder.cargoChange).
export type CargoChangeView = {
  status: CargoChangeStatus;
  toCode: string;
  toName: string;
  fromName: string | null;             // istek anında ekrandaki firma
  fromTrackingNumber: string | null;   // istek anındaki kargo kodu (değişirse etiket yenilenmeli)
  requestedAt: number;                 // ms
  appliedAt: number | null;            // TY'nin yeni firmayı ilk döndürdüğü an
  confirmDeadline: number;             // bu andan sonra pending → unconfirmed
};

export type CargoChangeEntry = {
  packageId: string;
  orderNumber: string | null;
  orderDate: number | null;
  fromName: string | null;
  fromTrackingNumber: string | null;
  toCode: string;
  toName: string;
  requestedAt: number;
  appliedAt: number | null;
  lastCheckedAt: number | null;
  checking: Promise<void> | null; // eşzamanlı TY kontrollerini tekilleştirir
};

const entries = new Map<string, CargoChangeEntry>(); // packageId → kayıt

function prune(now: number): void {
  for (const [id, e] of entries) {
    const expired = now - e.requestedAt > RETENTION_MS;
    const settled = e.appliedAt !== null && now - e.appliedAt > APPLIED_VISIBLE_MS;
    if (expired || settled) entries.delete(id);
  }
}

export function registerCargoChange(
  input: Omit<CargoChangeEntry, "requestedAt" | "appliedAt" | "lastCheckedAt" | "checking">,
  now = Date.now(),
): CargoChangeEntry {
  const entry: CargoChangeEntry = {
    ...input,
    requestedAt: now,
    appliedAt: null,
    lastCheckedAt: null,
    checking: null,
  };
  entries.set(input.packageId, entry);
  return entry;
}

export function getCargoChange(packageId: string, now = Date.now()): CargoChangeEntry | null {
  prune(now);
  return entries.get(packageId) ?? null;
}

export function hasTrackedCargoChanges(now = Date.now()): boolean {
  prune(now);
  return entries.size > 0;
}

// TY'nin döndürdüğü firma adı hedefe geçildiğini gösteriyor mu? Ad tanınıyorsa KOD
// karşılaştırılır. Tanınmıyorsa yalnız istek anındaki addan FARKLIYSA uygulandı sayılır
// (tanınan ama farklı bir firma ise uygulanmadı — ör. eski firma hâlâ duruyor).
export function isCargoChangeApplied(
  entry: Pick<CargoChangeEntry, "toCode" | "fromName">,
  currentName: string | null | undefined,
): boolean {
  if (!currentName) return false;
  const code = cargoProviderCodeFromName(currentName);
  if (code) return code === entry.toCode;
  return entry.fromName !== null && foldCargoName(currentName) !== foldCargoName(entry.fromName);
}

// Kaydın güncel görünümü. Uygulandığı İLK görüldüğünde appliedAt damgalanır ve
// yapışır: sonradan gelen bayat bir okuma durumu geri "pending"e çeviremez.
export function resolveCargoChange(
  entry: CargoChangeEntry,
  currentName: string | null | undefined,
  now = Date.now(),
): CargoChangeView {
  if (entry.appliedAt === null && isCargoChangeApplied(entry, currentName)) {
    entry.appliedAt = now;
  }
  const confirmDeadline = entry.requestedAt + CARGO_CHANGE_CONFIRM_TIMEOUT_MS;
  const status: CargoChangeStatus =
    entry.appliedAt !== null ? "applied" : now >= confirmDeadline ? "unconfirmed" : "pending";
  return {
    status,
    toCode: entry.toCode,
    toName: entry.toName,
    fromName: entry.fromName,
    fromTrackingNumber: entry.fromTrackingNumber,
    requestedAt: entry.requestedAt,
    appliedAt: entry.appliedAt,
    confirmDeadline,
  };
}

// Listedeki bir siparişin kaydı. Önce packageId; TY değişiklikte paketi yeniden
// numaralandırırsa (eski packageId listede yoksa) aynı sipariş numarasına düşer.
export function findCargoChangeForOrder(
  order: Pick<DisplayOrder, "packageId" | "orderNumber">,
  presentPackageIds: ReadonlySet<string>,
  now = Date.now(),
): CargoChangeEntry | null {
  prune(now);
  if (order.packageId) {
    const direct = entries.get(order.packageId);
    if (direct) return direct;
  }
  for (const e of entries.values()) {
    if (e.orderNumber === order.orderNumber && !presentPackageIds.has(e.packageId)) return e;
  }
  return null;
}

// Bekleyen kayıt için TY'ye iki hedefli kontrol arasındaki asgari süre: ilk dakikada
// sık (değişiklik çoğunlukla burada yansır), sonra seyrek. TY limiti 1000 istek/dk.
export function cargoCheckInterval(entry: CargoChangeEntry, now = Date.now()): number {
  const age = now - entry.requestedAt;
  if (age < 60_000) return 3_000;
  if (age < 3 * 60_000) return 8_000;
  return 20_000;
}

export function clearTrackedCargoChanges(): void {
  entries.clear();
}
