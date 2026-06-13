// v1.6 — Model C / Faz 1: Trendyol iade (claims) → inceleme kuyruğu senkronu.
//
// "İade kuyruğu boş kalıyor" deliğini kapatır. Sorun: orders ucu iadeleri
// 'Returned' statüsüyle güvenilir bildirmiyor (sipariş teslim göründüğü hâlde
// müşteri iade açıyor). Gerçek iade verisi /claims ucundan akıyor. Bu servis
// claims'i periyodik çeker ve her iadeyi, ilgili SAYILMIŞ sipariş satırına
// (channel_order_lines.state='counted') bağlayıp 'return_pending'e taşır → satır
// inceleme kuyruğuna düşer.
//
// Model C kuralı: iade OTOMATİK +stok YAPMAZ. Bu servis stock_movements'a HİÇBİR
// şey yazmaz, Trendyol'a hiçbir yazma yapmaz. Yalnız defter durumunu (state) ve
// claim üst verisini günceller. Operatör malı sağlamsa elle setStock'la ekleyip
// kuyruk kalemini resolve eder (order-sync.service'teki resolveOrderReviewItem).
//
// İdempotensi: bir iade satırı yalnız 'counted' iken 'return_pending'e taşınır;
// tekrar görmek no-op (zaten return_pending). resolved_at'e ASLA dokunulmaz
// (operatörün kararı korunur). Eşleşen sayılmış satır yoksa claim ATLANIR — stok
// etkisi olmayan iade için yeni defter satırı UYDURULMAZ (kuyruk anlamlı kalır).
//
// Tek-yazar: order-sync ile AYNI advisory lock (ORDER_SYNC_LOCK). İkisi de
// channel_order_lines.state yazar; aynı kilit order-sync'in bir iade satırını
// eşzamanlı geri 'counted'a çevirmesini engeller (order-sync planner'ı zaten
// return_pending'i "yapışkan" sayar; kilit ek güvence).

import type { PoolClient } from "pg";

import { pool } from "../../db/connection.js";
import { toServiceError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import { rollbackQuietly, withAdvisoryLock } from "../shared.js";
import { env } from "../../config/env.js";
import {
  ORDER_SYNC_LOCK,
  MarketplaceOrdersDisabledError,
  loadExisting,
  lineKey,
  type ExistingLine,
} from "./order-sync.service.js";
import {
  getClaims as defaultGetClaims,
  type GetClaimsParams,
  type TrendyolClaim,
  type TrendyolClaimsResponse,
} from "./client.js";

// ── Claim status → bizim niyetimiz ───────────────────────────────────────────
// active   → iade canlı/onaylı; kuyruğa düşür (Accepted/Created/WaitingInAction/
//            InAnalysis/Unresolved/Returned/bilinmeyen).
// inactive → iade iptal/ret; aksiyon gerekmez (Cancelled/Rejected). Bilinmeyen
//            "active" sayılır: gerçek iadeyi sessizce yutmaktansa operatöre göster.
export type ClaimCategory = "active" | "inactive";

export function classifyClaimStatus(status: string | null | undefined): ClaimCategory {
  const s = (status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s === "cancelled" || s === "canceled" || s === "rejected") return "inactive";
  return "active";
}

// Düzleştirilmiş tekil iade satırı (orderLine granülerliğinde; saf, ağ/DB yok).
export type IncomingClaim = {
  orderNumber: string;
  lineId: string;            // orderLine.id (orders lines[].id ile aynı uzay)
  barcode: string | null;
  claimId: string | null;
  claimStatus: string | null;  // temsilci status (aktif kalem varsa onunki)
  claimReason: string | null;  // temsilci sebep (name || code)
  returnedQty: number;         // iade edilen birim adedi (claimItems sayısı)
  claimDate: number | null;    // epoch ms
  isActiveReturn: boolean;     // en az bir claimItem 'active' mi
  raw: unknown;                // ham claim satırı (items[] elemanı)
};

// TY claim yanıtlarını orderLine bazlı tekil satırlara düzleştirir. Aynı
// (orderNumber, lineId) birden çok claim'de görünürse aktif + en yeni olanı tutar.
export function flattenClaims(claims: TrendyolClaim[]): IncomingClaim[] {
  const byKey = new Map<string, IncomingClaim>();

  for (const claim of claims) {
    const orderNumber = claim.orderNumber ? String(claim.orderNumber) : null;
    if (!orderNumber) continue;
    const claimId = (claim.claimId ?? claim.id) ? String(claim.claimId ?? claim.id) : null;
    const claimDate = typeof claim.claimDate === "number" ? claim.claimDate : null;

    for (const item of claim.items ?? []) {
      const ol = item.orderLine;
      const rawLineId = ol?.id;
      if (rawLineId === undefined || rawLineId === null || String(rawLineId) === "") continue;
      const lineId = String(rawLineId);
      const barcode = ol?.barcode ? String(ol.barcode) : null;

      const claimItems = item.claimItems ?? [];
      const activeItems = claimItems.filter(
        (ci) => classifyClaimStatus(ci.claimItemStatus?.name) === "active",
      );
      const isActiveReturn = activeItems.length > 0;
      const rep = activeItems[0] ?? claimItems[0] ?? null;
      const claimStatus = rep?.claimItemStatus?.name ?? null;
      const reason =
        rep?.trendyolClaimItemReason?.name ||
        rep?.trendyolClaimItemReason?.code ||
        rep?.customerClaimItemReason?.name ||
        rep?.customerClaimItemReason?.code ||
        null;
      const returnedQty = activeItems.length > 0 ? activeItems.length : claimItems.length;

      const candidate: IncomingClaim = {
        orderNumber,
        lineId,
        barcode,
        claimId,
        claimStatus,
        claimReason: reason,
        returnedQty,
        claimDate,
        isActiveReturn,
        raw: item,
      };

      const key = lineKey(orderNumber, lineId);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, candidate);
      } else {
        // Çakışma: aktif olanı, eşit aktiflikte daha yeni claimDate'i tut.
        const preferCandidate =
          (candidate.isActiveReturn && !prev.isActiveReturn) ||
          (candidate.isActiveReturn === prev.isActiveReturn &&
            (candidate.claimDate ?? 0) >= (prev.claimDate ?? 0));
        if (preferCandidate) byKey.set(key, candidate);
      }
    }
  }

  return [...byKey.values()];
}

// 'counted' satırı 'return_pending'e taşıyacak tek bir plan kalemi.
export type ClaimPlan = {
  key: string;
  existingId: string;
  orderNumber: string;
  lineId: string;
  claimId: string | null;
  claimStatus: string | null;
  claimReason: string | null;
  claimQuantity: number;
  claimDate: number | null;
  raw: unknown;
};

export type ClaimReconcilePlan = {
  registers: ClaimPlan[];
  summary: {
    claimLinesSeen: number;
    returnsRegistered: number; // counted → return_pending (bu turda)
    alreadyPending: number;    // zaten return_pending (idempotent no-op)
    inactiveClaims: number;    // iptal/ret iade (aksiyon yok)
    unlinkedClaims: number;    // eşleşen sayılmış satır yok (stok etkisi yok)
    skippedOther: number;      // eşleşti ama state counted/return_pending değil
  };
};

// Saf çekirdek: gelen iade satırları + mevcut defter → plan. DB/ağ YOK (offline test).
export function planClaimReconciliation(
  incoming: IncomingClaim[],
  existing: Map<string, ExistingLine>,
): ClaimReconcilePlan {
  const registers: ClaimPlan[] = [];
  let returnsRegistered = 0, alreadyPending = 0, inactiveClaims = 0, unlinkedClaims = 0, skippedOther = 0;

  for (const c of incoming) {
    const key = lineKey(c.orderNumber, c.lineId);
    const prior = existing.get(key) ?? null;

    if (!c.isActiveReturn) {
      // Cancelled/Rejected → iade gerçekleşmiyor. return_pending'e taşımayız.
      // (Daha önce taşınmış bir satırı OTOMATİK geri almayız da — Model C: operatör
      //  karar verir; resolve eder. Auto-revert yok.)
      inactiveClaims += 1;
      continue;
    }
    if (!prior) {
      // Hiç saymadığımız satır (sipariş penceresi dışında ya da hiç senkronlanmamış)
      // → stok düşmemiştik, iadenin stok etkisi yok. Yeni satır uydurmayız.
      unlinkedClaims += 1;
      continue;
    }
    if (prior.state === "return_pending") {
      alreadyPending += 1; // idempotent: zaten kuyrukta
      continue;
    }
    if (prior.state === "counted") {
      registers.push({
        key,
        existingId: prior.id,
        orderNumber: c.orderNumber,
        lineId: c.lineId,
        claimId: c.claimId,
        claimStatus: c.claimStatus,
        claimReason: c.claimReason,
        claimQuantity: c.returnedQty,
        claimDate: c.claimDate,
        raw: c.raw,
      });
      returnsRegistered += 1;
      continue;
    }
    // reversed / unmatched / ignored / setup_pending → stok düşülmemiş; iadenin
    // stok etkisi yok, kuyruğa zorlamayız.
    skippedOther += 1;
  }

  return {
    registers,
    summary: { claimLinesSeen: incoming.length, returnsRegistered, alreadyPending, inactiveClaims, unlinkedClaims, skippedOther },
  };
}

export type ClaimSyncDeps = {
  // Test/izolasyon için enjekte edilebilir iade çekici. Varsayılan: gerçek client.
  fetchClaims?: (params: GetClaimsParams) => Promise<TrendyolClaimsResponse>;
};

const CLAIMS_PAGE_SIZE = 200;
const MAX_CLAIM_PAGES = 50;

// Pencere içindeki tüm claim sayfalarını çeker (ağ; transaction DIŞINDA). Pencere
// claimDate'e göre süzülür (PROD'da doğrulandı: startDate/endDate).
async function fetchClaimsWindow(
  fetchClaims: (params: GetClaimsParams) => Promise<TrendyolClaimsResponse>,
  windowDays: number,
): Promise<TrendyolClaim[]> {
  const now = Date.now();
  const startDate = now - windowDays * 86_400_000;
  const out: TrendyolClaim[] = [];
  let page = 0;
  while (page < MAX_CLAIM_PAGES) {
    const resp = await fetchClaims({ startDate, endDate: now, page, size: CLAIMS_PAGE_SIZE });
    const content = resp.content ?? [];
    out.push(...content);
    const totalPages = resp.totalPages ?? 1;
    page += 1;
    if (page >= totalPages || content.length === 0) break;
  }
  return out;
}

export type ClaimSyncResult = ClaimReconcilePlan["summary"] & { applied: boolean };

// Tam senkron akışı: flag kontrol → claims çek (ağ) → transaction'da eşle/planla/
// uygula. PUSH YOK, stok hareketi YOK. Flag kapalıysa MarketplaceOrdersDisabledError.
export async function syncTrendyolClaims(deps: ClaimSyncDeps = {}): Promise<ClaimSyncResult> {
  const settings = await getSettings();
  if (!settings.marketplaceOrdersEnabled) {
    throw new MarketplaceOrdersDisabledError();
  }

  const fetchClaims = deps.fetchClaims ?? defaultGetClaims;

  // 1) Ağ: pencereyi çek (kilit YOK).
  const rawClaims = await fetchClaimsWindow(fetchClaims, env.trendyolClaimWindowDays);
  const incoming = flattenClaims(rawClaims);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 2) Tek-yazar: order-sync ile AYNI global kilit.
    await withAdvisoryLock(client, ORDER_SYNC_LOCK);

    // 3) Mevcut defter (txn içinde, tutarlı snapshot).
    const orderNumbers = [...new Set(incoming.map((c) => c.orderNumber))];
    const existing = await loadExisting(client, orderNumbers);

    // 4) Saf planla.
    const { registers, summary } = planClaimReconciliation(incoming, existing);

    // 5) Uygula: yalnız 'counted' satırı 'return_pending'e taşı + claim üst verisi.
    //    resolved_at / applied_delta / product_id / quantity'ye DOKUNMA. Stok YOK.
    //    WHERE state='counted' guard'ı idempotensi + eşzamanlılık güvencesidir.
    for (const p of registers) {
      const claimDateIso = p.claimDate !== null ? new Date(p.claimDate).toISOString() : null;
      await client.query(
        `UPDATE channel_order_lines
            SET state = 'return_pending',
                claim_id = $2, claim_status = $3, claim_reason = $4,
                claim_quantity = $5, claim_date = $6, claim_raw = $7,
                last_seen_at = now()
          WHERE id = $1 AND channel = 'trendyol' AND state = 'counted'`,
        [
          p.existingId, p.claimId, p.claimStatus, p.claimReason,
          p.claimQuantity, claimDateIso, JSON.stringify(p.raw ?? null),
        ],
      );
    }

    await client.query("COMMIT");
    return { ...summary, applied: true };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
