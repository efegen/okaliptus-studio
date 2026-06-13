// v1.6 — Model C / Faz 2: iç (efektif) stoğu Trendyol'a PUSH (yazma).
//
// Projenin EN RİSKLİ kısmı. Körlemesine push = TY'deki tüm canlı kataloğu sıfırlama
// riski (iç stok çoğu üründe 0/boş; gerçek stok TY'de). Aşağıdaki kilitler bunu KOD
// SEVİYESİNDE imkânsız kılar (prosedür değil, interlock):
//
//   1) BASELINE INTERLOCK — listing baselined_at taşımıyorsa push o satıra YAZMAZ
//      (eligible dışı). Önce baselineChannelListings() iç açılış stoğunu TY adediyle
//      hizalar ve last_pushed = TY adedi yapar → baseline sonrası ilk plan ~0 değişiklik.
//   2) KÜTLESEL-SIFIR DEVRE KESİCİ — bir reconcile turu listelerin >%20'sini ya da
//      >5 listeyi 0'a düşürecek/büyük düşüş yapacaksa DUR (force ile aşılır).
//   3) DRY-RUN VARSAYILAN — marketplace_stock_push_dry_run=true iken yalnız plan logu,
//      TY'ye çağrı YOK. Gerçek yazma ancak operatör dry-run'ı bilerek kapatınca.
//   5) STOK-ONLY — yalnız { barcode, quantity } gönderilir; fiyata ASLA dokunulmaz.
//   6) NEGATİF → 0 — efektif stok eksiyse 0 gönderilir.
//   7) DEĞİŞMEDİYSE PUSH'LAMA — last_pushed_quantity ile karşılaştırılır; yalnız fark
//      push edilir. Başarı DOĞRULANINCA güncellenir, başarısızsa DOKUNULMAZ (retry).
//   8) ASYNC BATCH DOĞRULAMA — updateStock batchId döner; getBatchResult poll'lanıp
//      gerçekten uygulandığı doğrulanır. 200-submit başarı SAYILMAZ.
//   9) BUNDLE KASKAD — bundle'ın türev efektif stoğu (v_product_effective_stock) push
//      edilir; bileşen değişince türev otomatik değişir, sonraki reconcile yakalar.
//  10) TEK-YAZAR + KİLİT — push tek-uçuş (PUSH_LOCK try-advisory); efektif stok ürün
//      başına stockLockKey ALTINDA okunur (satışla yarış yok).
//  11) KAPSAM — arşivli iç ürün + baseline'sız + is_listed=false (delist) ATLANIR.
//  12) KILL SWITCH + GÖZLEM — flag her turda kontrol; her deneme channel_push_log'a.
//
// GELİŞTİRMEDE CANLIYA YAZMA YOK: client enjekte edilir (deps.updateStock/getBatchResult);
// smoke offline fake enjekte eder. Gerçek client yalnız PROD'da, flag+dry-run kapalıyken.

import type { PoolClient } from "pg";

import { pool } from "../../db/connection.js";
import { AppError, ValidationError, toServiceError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import { isStockTrackingEnabled, setStock, stockLockKey } from "../stock.service.js";
import { rollbackQuietly, withAdvisoryLock, type EntityId } from "../shared.js";
import { MarketplaceSyncDisabledError } from "./orders.service.js";
import {
  updateStock as defaultUpdateStock,
  getBatchRequestResult as defaultGetBatchResult,
  type TrendyolStockItem,
  type TrendyolBatchSubmitResponse,
  type TrendyolBatchResult,
} from "./client.js";

// Tüm push çalışmalarını (poller + manuel uç + çoklu instance) seri hale getiren
// global tek-uçuş kilidi (session-level try-advisory; xact değil çünkü ağ çağrısı
// boyunca tutulur). order-sync'ten AYRI kilit → ikisi paralel çalışabilir.
const PUSH_LOCK = "trendyol_stock_push";

const CHUNK_SIZE = 100;          // tek price-and-inventory isteğindeki kalem üst sınırı
const BATCH_POLL_ATTEMPTS = 5;   // batch sonucu için poll denemesi
const BATCH_POLL_DELAY_MS = 1500;

// Devre kesici eşikleri (#2): bir reconcile turu listelerin > %20'sini YA DA > 5
// listeyi tehlikeli biçimde düşürecekse DUR. OR → düşük eşikte tetiklenir (savunmacı).
const MASS_ZERO_ABS = 5;
const MASS_DROP_RATIO = 0.2;
// Devre kesicinin "yakın zamanda uygulanmış tehlikeli düşüş" penceresi (dk). Kütlesel
// sıfırlamanın tur-tur sızmasını (self-clearing trickle) engeller; pencere geçince
// meşru tedrici satış-düşüşleri tekrar serbest kalır.
const DANGEROUS_WINDOW_MIN = 60;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class StockPushDisabledError extends AppError {
  constructor(message = "Pazaryeri stok gönderimi kapalı. Ayarlardan 'Stok gönderimi'ni açın.") {
    super("STOCK_PUSH_DISABLED", message, 409);
  }
}

// ── Saf çekirdek (ağ/DB yok; offline test edilebilir) ───────────────────────

// Gönderilecek hedef adet: efektif stok eksiyse 0 (#6); aksi halde aynısı.
export function computeDesiredQuantity(effective: number): number {
  if (!Number.isFinite(effective)) return 0;
  return effective < 0 ? 0 : Math.floor(effective);
}

// Bir push kaleminin "tehlikeli düşüş" olup olmadığı (ölçekten BAĞIMSIZ): referans
// adetten (TY'de bildiğimiz son adet) düşüyor VE ya sıfırlıyor ya da hem >=%50 hem
// >=3 birim siliyor. Eski "prev>=10" kapısı KALDIRILDI (küçük stoklu listelerin
// 9→1 gibi neredeyse-tam düşüşleri de yakalanır); 3 birimlik taban küçük (2→1)
// satışları gürültü saymaz. reference null (kıyas yok) → tehlikeli değil.
export function isDangerousDrop(reference: number | null, next: number): boolean {
  if (reference === null || reference === undefined) return false;
  if (next >= reference) return false;
  if (next === 0 && reference > 0) return true;                          // sıfırlama (her ölçek)
  if (reference - next >= Math.max(3, reference * 0.5)) return true;     // >=%50 ve >=3 birim
  return false;
}

export type PushPlanItem = {
  listingId: string;
  productId: string;
  externalId: string;
  productName: string | null;
  isBundle: boolean;
  prev: number | null;   // last_pushed_quantity (referans)
  effective: number;     // ham efektif stok (eksi olabilir)
  desired: number;       // gönderilecek (>=0)
  delta: number | null;  // desired - prev
};

export type CircuitBreakerVerdict = {
  tripped: boolean;
  dangerousCount: number;        // bu turdaki tehlikeli düşüşler
  recentDangerousCount: number;  // pencere içinde yakın zamanda UYGULANMIŞ tehlikeli düşüşler
  windowedCount: number;         // dangerousCount + recentDangerousCount
  consideredCount: number;
  ratio: number;
};

// Devre kesici (#2). force=true her zaman geçer. onlyProductId (tek ürün, kasıtlı
// operatör aksiyonu) "mass" değildir → çağıran bunu zaten atlar.
//
// PENCERE FARKINDALIĞI: yalnız bu turdaki tehlikeli düşüşlere bakmak YETMEZ — sıfıra
// düşen liste sonraki turda 'changed' kümesinden çıktığı için (last_pushed=0=desired)
// kütlesel sıfırlama tur başına <=5'er sızarak kataloğu yavaşça boşaltabilirdi. Bu
// yüzden son DANGEROUS_WINDOW dakikada GERÇEKTEN uygulanmış tehlikeli düşüşler de
// (recentDangerousCount) toplama katılır; tetik eşiği windowed toplam üzerinden bakılır.
export function evaluateCircuitBreaker(
  changed: PushPlanItem[],
  recentDangerousCount: number,
  consideredCount: number,
  force: boolean,
): CircuitBreakerVerdict {
  const dangerousCount = changed.filter((i) => isDangerousDrop(i.prev, i.desired)).length;
  const windowedCount = dangerousCount + recentDangerousCount;
  const ratio = consideredCount > 0 ? dangerousCount / consideredCount : 0;
  const tripped = !force && (windowedCount > MASS_ZERO_ABS || ratio > MASS_DROP_RATIO);
  return { tripped, dangerousCount, recentDangerousCount, windowedCount, consideredCount, ratio };
}

export type ItemVerdict = "success" | "failed" | "pending";

// Batch sonucunu kalemlere böler (#8). 200-submit'i ASLA başarı sayma; başarı için
// POZİTİF kanıt şart (kalem sonuçta açıkça SUCCESS olmalı):
//   • status COMPLETED değilse → hepsi 'pending' (henüz doğrulanmadı, retry).
//   • COMPLETED + kalem SUCCESS → 'success'.
//   • COMPLETED + kalem FAILED/diğer → 'failed' (+sebep).
//   • COMPLETED + kalem sonuçta YOK → 'pending' (DOĞRULANAMADI; başarı SAYILMAZ →
//     last_pushed ilerlemez, sonraki tur tekrar dener). Boş/eksik items[] gövdesi bir
//     başarı kanıtı DEĞİLDİR; aggregate failedItemCount=0'a bakıp başarı uydurmayız.
export function classifyBatchResult(
  batch: TrendyolBatchResult,
  barcodes: string[],
): Map<string, { verdict: ItemVerdict; error: string | null }> {
  const out = new Map<string, { verdict: ItemVerdict; error: string | null }>();
  const completed = (batch.status ?? "").toUpperCase() === "COMPLETED";
  if (!completed) {
    for (const b of barcodes) out.set(b, { verdict: "pending", error: null });
    return out;
  }
  const byBarcode = new Map<string, { status?: string; failureReasons?: string[] }>();
  for (const it of batch.items ?? []) {
    const bc = it.requestItem?.barcode;
    if (bc) byBarcode.set(String(bc), { status: it.status, failureReasons: it.failureReasons });
  }

  for (const bc of barcodes) {
    const bi = byBarcode.get(bc);
    if (!bi) {
      // Kalem yanıtta YOK → uygulandığına dair kanıt yok. 'pending' (retry); başarı UYDURMA.
      out.set(bc, { verdict: "pending", error: null });
      continue;
    }
    const st = (bi.status ?? "").toUpperCase();
    if (st === "SUCCESS") {
      out.set(bc, { verdict: "success", error: null });
    } else {
      const reason = (bi.failureReasons && bi.failureReasons.length > 0)
        ? bi.failureReasons.join("; ")
        : st || "Trendyol reddetti";
      out.set(bc, { verdict: "failed", error: reason.slice(0, 500) });
    }
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Baseline operasyonu (#1) ────────────────────────────────────────────────
// adopt tohumlamasının toplu hâli: her eşli ürünün iç açılış stoğunu = o anki TY
// adedi (channel_products snapshot) yapar ve last_pushed = TY adedi işaretler.
// İdempotent: yalnız baselined_at IS NULL satırlar işlenir (force ile yeniden).
//
// Seeding kuralı (POS geçmişini KORU): iç stok yalnız basit ürün + hareketi HİÇ
// olmayan ürün için TY adedine setStock'lanır. Hareketi olan (adopt-seeded ya da
// satışlı) ürünün iç stoğuna DOKUNULMAZ — last_pushed yine TY adedi olur, böylece
// satılmış fark sonraki push'ta TY'ye yansır (doğru). Bundle'a stok seed edilmez
// (türev); yalnız last_pushed=TY adedi işaretlenir.
export type BaselineResult = {
  processed: number;
  baselined: number;
  seeded: number;          // iç açılış stoğu TY adedine setStock'landı
  skippedArchived: number;
  skippedNoSnapshot: number; // snapshot yok / quantity null → baseline yapılamadı
};

export async function baselineChannelListings(opts: {
  force?: boolean;
  actorUserId?: number | string | null;
  // İsteğe bağlı kapsam: yalnız bu ürünlerin listelerini baseline'la (null = tümü).
  // Üretimde tümü; smoke kendi ürünlerine izole etmek için kullanır.
  productIds?: EntityId[] | null;
} = {}): Promise<BaselineResult> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) throw new MarketplaceSyncDisabledError();
  if (!settings.stockTrackingEnabled) {
    throw new ValidationError("Baseline için 'Stok takibi' açık olmalı (iç açılış stoğu TY adedine hizalanır).");
  }

  const force = opts.force === true;
  const actorUserId = opts.actorUserId ?? null;
  const productIds = opts.productIds && opts.productIds.length > 0 ? opts.productIds.map(String) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const rows = await client.query<{
      listing_id: string; product_id: string; external_id: string;
      archived_at: string | null; is_bundle: boolean;
      ty_qty: number | null; movement_count: number;
    }>(
      `SELECT cl.id AS listing_id, cl.product_id, cl.external_id,
              p.archived_at, p.is_bundle,
              cp.quantity AS ty_qty,
              (SELECT count(*) FROM stock_movements sm
                WHERE sm.product_id = cl.product_id AND sm.deleted_at IS NULL) AS movement_count
         FROM channel_listings cl
         JOIN products p ON p.id = cl.product_id
         LEFT JOIN channel_products cp
           ON cp.channel = 'trendyol' AND cp.external_id = cl.external_id
        WHERE cl.channel = 'trendyol'
          AND ($1::boolean OR cl.baselined_at IS NULL)
          AND ($2::bigint[] IS NULL OR cl.product_id = ANY($2::bigint[]))
        ORDER BY cl.id ASC`,
      [force, productIds],
    );

    let baselined = 0, seeded = 0, skippedArchived = 0, skippedNoSnapshot = 0;

    for (const r of rows.rows) {
      if (r.archived_at !== null) { skippedArchived += 1; continue; }
      if (r.ty_qty === null || !Number.isFinite(Number(r.ty_qty))) { skippedNoSnapshot += 1; continue; }
      const tyQty = Math.max(0, Math.floor(Number(r.ty_qty)));

      // Basit ürün + hiç hareketi yok → iç açılış stoğunu TY adedine hizala.
      if (r.is_bundle !== true && Number(r.movement_count) === 0) {
        await setStock(client, {
          productId: r.product_id,
          newOnHand: tyQty,
          note: "Trendyol baseline açılış stoğu",
          actorUserId,
        });
        seeded += 1;
      }

      await client.query(
        `UPDATE channel_listings
            SET baselined_at = now(),
                baseline_quantity = $2,
                last_pushed_quantity = $2,
                last_push_status = NULL,
                last_push_error = NULL
          WHERE id = $1`,
        [r.listing_id, tyQty],
      );
      baselined += 1;
    }

    await client.query("COMMIT");
    return { processed: rows.rows.length, baselined, seeded, skippedArchived, skippedNoSnapshot };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ── Plan oluşturma (#7/#10/#11) ─────────────────────────────────────────────
type RawCandidate = {
  listing_id: string; product_id: string; external_id: string; product_name: string | null;
  is_listed: boolean; baselined_at: string | null; last_pushed_quantity: number | null;
  archived_at: string | null; is_bundle: boolean;
};

export type PushPlan = {
  eligible: PushPlanItem[];
  changed: PushPlanItem[];
  consideredCount: number;
  skipped: { archived: number; notBaselined: number; delisted: number };
};

// Eligible listing'ler için efektif stoğu ürün başına stockLockKey ALTINDA okur,
// hedef adedi hesaplar, last_pushed ile karşılaştırıp değişeni işaretler. Kendi
// txn'inde çalışır (ağ YOK); kilitler txn sonunda bırakılır.
async function buildPushPlan(
  onlyProductId: EntityId | null,
  scopeProductIds: string[] | null,
): Promise<PushPlan> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cand = await client.query<RawCandidate>(
      `SELECT cl.id AS listing_id, cl.product_id, cl.external_id, p.name AS product_name,
              cl.is_listed, cl.baselined_at, cl.last_pushed_quantity,
              p.archived_at, p.is_bundle
         FROM channel_listings cl
         JOIN products p ON p.id = cl.product_id
        WHERE cl.channel = 'trendyol'
          AND ($1::bigint IS NULL OR cl.product_id = $1::bigint)
          AND ($2::bigint[] IS NULL OR cl.product_id = ANY($2::bigint[]))
        ORDER BY cl.id ASC`,
      [onlyProductId ?? null, scopeProductIds],
    );

    const skipped = { archived: 0, notBaselined: 0, delisted: 0 };
    const eligibleRows: RawCandidate[] = [];
    for (const r of cand.rows) {
      if (r.archived_at !== null) { skipped.archived += 1; continue; }
      if (r.baselined_at === null) { skipped.notBaselined += 1; continue; } // INTERLOCK #1
      if (r.is_listed !== true) { skipped.delisted += 1; continue; }        // #11
      eligibleRows.push(r);
    }

    if (eligibleRows.length === 0) {
      await client.query("COMMIT");
      return { eligible: [], changed: [], consideredCount: 0, skipped };
    }

    // Kilit hedefleri: eligible ürün id'leri + (bundle ise) bileşen id'leri.
    const productIds = eligibleRows.map((r) => r.product_id);
    const comps = await client.query<{ bundle_product_id: string; component_product_id: string }>(
      `SELECT bundle_product_id, component_product_id
         FROM bundle_components
        WHERE bundle_product_id = ANY($1::bigint[])`,
      [productIds],
    );
    const lockSet = new Set<string>(productIds);
    for (const c of comps.rows) lockSet.add(c.component_product_id);
    // Deadlock önleme: POS/order-sync ile aynı key, ARTAN sırada al.
    for (const id of [...lockSet].sort()) await withAdvisoryLock(client, stockLockKey(id));

    // Kilit altında efektif stoğu oku.
    const eff = await client.query<{ product_id: string; on_hand: number }>(
      `SELECT product_id, on_hand FROM v_product_effective_stock
        WHERE product_id = ANY($1::bigint[])`,
      [productIds],
    );
    const effMap = new Map<string, number>();
    for (const e of eff.rows) effMap.set(e.product_id, Number(e.on_hand));

    const eligible: PushPlanItem[] = eligibleRows.map((r) => {
      const effective = effMap.get(r.product_id) ?? 0;
      const desired = computeDesiredQuantity(effective);
      const prev = r.last_pushed_quantity === null ? null : Number(r.last_pushed_quantity);
      return {
        listingId: r.listing_id,
        productId: r.product_id,
        externalId: r.external_id,
        productName: r.product_name,
        isBundle: r.is_bundle === true,
        prev,
        effective,
        desired,
        delta: prev === null ? null : desired - prev,
      };
    });

    // Değişen = prev bilinmiyor (null) ya da desired != prev (#7).
    const changed = eligible.filter((i) => i.prev === null || i.desired !== i.prev);

    await client.query("COMMIT");
    return { eligible, changed, consideredCount: eligible.length, skipped };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ── Log + listing durum yazımı ──────────────────────────────────────────────
async function insertPushLog(
  client: PoolClient,
  entry: {
    listingId: string; productId: string; externalId: string;
    prev: number | null; newQty: number; mode: "dry_run" | "live";
    result: "planned" | "submitted" | "success" | "failed" | "skipped_breaker";
    batchId: string | null; error: string | null; actorUserId: number | string | null;
  },
): Promise<void> {
  const delta = entry.prev === null ? null : entry.newQty - entry.prev;
  await client.query(
    `INSERT INTO channel_push_log
       (channel, listing_id, product_id, external_id, prev_quantity, new_quantity,
        delta, mode, result, batch_id, error, actor_user_id)
     VALUES ('trendyol', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      entry.listingId, entry.productId, entry.externalId, entry.prev, entry.newQty,
      delta, entry.mode, entry.result, entry.batchId, entry.error, entry.actorUserId,
    ],
  );
}

export type StockPushResult = {
  mode: "disabled" | "already_running" | "noop" | "dry_run" | "live" | "breaker_tripped";
  dryRun: boolean;
  consideredCount: number;
  changedCount: number;
  pushedCount: number;   // doğrulanmış başarı
  failedCount: number;
  pendingCount: number;
  skipped: { archived: number; notBaselined: number; delisted: number };
  breaker: CircuitBreakerVerdict | null;
  items: Array<{
    externalId: string; productId: string; productName: string | null;
    prev: number | null; desired: number; delta: number | null;
    result: "planned" | "success" | "failed" | "pending" | "skipped_breaker";
  }>;
};

export type StockPushDeps = {
  updateStock?: (items: TrendyolStockItem[]) => Promise<TrendyolBatchSubmitResponse>;
  getBatchResult?: (batchRequestId: string) => Promise<TrendyolBatchResult>;
};

// Batch sonucunu COMPLETED olana dek (ya da deneme bitene dek) poll'lar. İlk poll
// gecikmesiz (offline smoke uyumaz); sonraki denemeler arası kısa bekleme.
async function pollBatch(
  getBatchResult: (id: string) => Promise<TrendyolBatchResult>,
  batchId: string,
): Promise<TrendyolBatchResult> {
  let last: TrendyolBatchResult = {};
  for (let attempt = 0; attempt < BATCH_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(BATCH_POLL_DELAY_MS);
    last = await getBatchResult(batchId);
    if ((last.status ?? "").toUpperCase() === "COMPLETED") return last;
  }
  return last; // COMPLETED olmadı → classifyBatchResult hepsini 'pending' sayar
}

// Pencere içinde GERÇEKTEN uygulanmış (result='success', mode='live') tehlikeli
// düşüşlerin sayısı. Devre kesicinin tur-tur sızan kütlesel sıfırlamayı yakalaması
// için (self-clearing trickle). scopeProductIds verilirse o kümeye süzülür (smoke
// izolasyonu + kirli-küme tetiklemesi); null → tüm katalog.
async function countRecentDangerousSuccesses(scopeProductIds: string[] | null): Promise<number> {
  const res = await pool.query<{ prev: number | null; next: number }>(
    `SELECT prev_quantity AS prev, new_quantity AS next
       FROM channel_push_log
      WHERE channel = 'trendyol' AND mode = 'live' AND result = 'success'
        AND created_at > now() - make_interval(mins => $1::int)
        AND ($2::bigint[] IS NULL OR product_id = ANY($2::bigint[]))`,
    [DANGEROUS_WINDOW_MIN, scopeProductIds],
  );
  return res.rows.filter((r) => isDangerousDrop(r.prev === null ? null : Number(r.prev), Number(r.next))).length;
}

// ── Tam push akışı ──────────────────────────────────────────────────────────
// Tek-uçuş (PUSH_LOCK). Flag kapalı → StockPushDisabledError. dry-run → yalnız plan
// logu, TY çağrısı YOK. overrideDryRun + onlyProductId → operatörün KASITLI tek-ürün
// canlı yazması (ilk gerçek yazma bunun üzerinden yapılır). force → devre kesiciyi aşar.
export async function runStockPush(opts: {
  deps?: StockPushDeps;
  force?: boolean;
  onlyProductId?: EntityId | null;
  // Kapsam: yalnız bu ürünleri reconcile et (null = tüm katalog). "kirli küme"
  // tetiklemesi (satış/order-sync sonrası) bunu kullanabilir; smoke izolasyon için.
  scopeProductIds?: EntityId[] | null;
  overrideDryRun?: boolean;
  actorUserId?: number | string | null;
} = {}): Promise<StockPushResult> {
  const settings = await getSettings();
  if (!settings.marketplaceStockPushEnabled) throw new StockPushDisabledError(); // KILL SWITCH

  const onlyProductId = opts.onlyProductId ?? null;
  const scopeProductIds = opts.scopeProductIds && opts.scopeProductIds.length > 0
    ? opts.scopeProductIds.map(String) : null;
  const force = opts.force === true;
  const actorUserId = opts.actorUserId ?? null;

  let dryRun = settings.marketplaceStockPushDryRun;
  if (opts.overrideDryRun === true) {
    if (onlyProductId === null) {
      throw new ValidationError("Canlı yazma yalnız tek ürün için elle aşılabilir (toplu değil).");
    }
    dryRun = false; // KASITLI tek-ürün canlı yazma
  }

  const updateStock = opts.deps?.updateStock ?? defaultUpdateStock;
  const getBatchResult = opts.deps?.getBatchResult ?? defaultGetBatchResult;

  const base: Omit<StockPushResult, "mode"> = {
    dryRun, consideredCount: 0, changedCount: 0, pushedCount: 0, failedCount: 0,
    pendingCount: 0, skipped: { archived: 0, notBaselined: 0, delisted: 0 },
    breaker: null, items: [],
  };

  // Tek-uçuş: ayrı bağlantıda session-level try-advisory lock; ağ boyunca tutulur.
  const lockConn = await pool.connect();
  let haveLock = false;
  try {
    const got = await lockConn.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS ok",
      [PUSH_LOCK],
    );
    if (got.rows[0]?.ok !== true) {
      return { ...base, mode: "already_running" };
    }
    haveLock = true;

    // 1) Plan (kilit altında efektif okuma, ağ yok).
    const plan = await buildPushPlan(onlyProductId, scopeProductIds);
    base.consideredCount = plan.consideredCount;
    base.changedCount = plan.changed.length;
    base.skipped = plan.skipped;

    // 2) Devre kesici (pencere-farkındalıklı). Tek-ürün kasıtlı aksiyonda atlanır
    //    (mass değil). Poller de bu yolda (force YOK) → otomatik kütlesel sıfırlama da
    //    durdurulur; pencere içindeki yakın tehlikeli düşüşler toplama katılır.
    const recentDangerous = onlyProductId !== null ? 0 : await countRecentDangerousSuccesses(scopeProductIds);
    const breaker: CircuitBreakerVerdict = onlyProductId !== null
      ? { tripped: false, dangerousCount: 0, recentDangerousCount: 0, windowedCount: 0, consideredCount: plan.consideredCount, ratio: 0 }
      : evaluateCircuitBreaker(plan.changed, recentDangerous, plan.consideredCount, force);
    base.breaker = breaker;

    if (breaker.tripped) {
      const logClient = await pool.connect();
      try {
        await logClient.query("BEGIN");
        for (const i of plan.changed) {
          await insertPushLog(logClient, {
            listingId: i.listingId, productId: i.productId, externalId: i.externalId,
            prev: i.prev, newQty: i.desired, mode: dryRun ? "dry_run" : "live",
            result: "skipped_breaker", batchId: null,
            error: `Devre kesici: ${breaker.dangerousCount} tehlikeli düşüş (%${Math.round(breaker.ratio * 100)}). Onay için force gerekli.`,
            actorUserId,
          });
        }
        await logClient.query("COMMIT");
      } catch { await rollbackQuietly(logClient); } finally { logClient.release(); }
      return {
        ...base, mode: "breaker_tripped",
        items: plan.changed.map((i) => ({
          externalId: i.externalId, productId: i.productId, productName: i.productName,
          prev: i.prev, desired: i.desired, delta: i.delta, result: "skipped_breaker",
        })),
      };
    }

    if (plan.changed.length === 0) {
      return { ...base, mode: "noop" };
    }

    // 3) DRY-RUN: yalnız plan logu, TY'ye çağrı YOK, listing'e DOKUNMA.
    if (dryRun) {
      const logClient = await pool.connect();
      try {
        await logClient.query("BEGIN");
        for (const i of plan.changed) {
          await insertPushLog(logClient, {
            listingId: i.listingId, productId: i.productId, externalId: i.externalId,
            prev: i.prev, newQty: i.desired, mode: "dry_run", result: "planned",
            batchId: null, error: null, actorUserId,
          });
        }
        await logClient.query("COMMIT");
      } catch { await rollbackQuietly(logClient); } finally { logClient.release(); }
      return {
        ...base, mode: "dry_run",
        items: plan.changed.map((i) => ({
          externalId: i.externalId, productId: i.productId, productName: i.productName,
          prev: i.prev, desired: i.desired, delta: i.delta, result: "planned",
        })),
      };
    }

    // 4) CANLI: chunk'la, gönder, DOĞRULA, durumu yaz.
    const items: StockPushResult["items"] = [];
    for (const group of chunk(plan.changed, CHUNK_SIZE)) {
      // STOK-ONLY (#5): yalnız barcode + quantity. Fiyat alanı GÖNDERİLMEZ.
      const payload: TrendyolStockItem[] = group.map((i) => ({ barcode: i.externalId, quantity: i.desired }));

      let batchId: string | null = null;
      let submitError: string | null = null;
      try {
        const sub = await updateStock(payload);
        batchId = sub.batchRequestId ? String(sub.batchRequestId) : null;
        if (!batchId) submitError = "Trendyol batchRequestId döndürmedi.";
      } catch (err) {
        submitError = err instanceof Error ? err.message : String(err);
      }

      if (submitError) {
        // Gönderim başarısız → tüm chunk 'failed' (last_pushed DOKUNULMAZ → retry).
        await applyChunkResults(group, batchId, "failed", submitError, dryRun, actorUserId);
        for (const i of group) {
          items.push({ externalId: i.externalId, productId: i.productId, productName: i.productName, prev: i.prev, desired: i.desired, delta: i.delta, result: "failed" });
          base.failedCount += 1;
        }
        continue;
      }

      // DOĞRULA (#8): batchId'yi poll'la.
      const batch = await pollBatch(getBatchResult, batchId!);
      const verdicts = classifyBatchResult(batch, group.map((i) => i.externalId));
      await applyVerifiedResults(group, batchId!, verdicts, actorUserId);
      for (const i of group) {
        const v = verdicts.get(i.externalId) ?? { verdict: "pending" as ItemVerdict, error: null };
        items.push({ externalId: i.externalId, productId: i.productId, productName: i.productName, prev: i.prev, desired: i.desired, delta: i.delta, result: v.verdict });
        if (v.verdict === "success") base.pushedCount += 1;
        else if (v.verdict === "failed") base.failedCount += 1;
        else base.pendingCount += 1;
      }
    }

    return { ...base, mode: "live", items };
  } finally {
    if (haveLock) {
      try { await lockConn.query("SELECT pg_advisory_unlock(hashtext($1))", [PUSH_LOCK]); } catch { /* yut */ }
    }
    lockConn.release();
  }
}

// Tüm chunk'ı tek sonuçla yaz (gönderim hatası → failed). last_pushed_quantity'ye
// DOKUNULMAZ (retry); yalnız durum/hata + log.
async function applyChunkResults(
  group: PushPlanItem[],
  batchId: string | null,
  result: "failed",
  error: string | null,
  dryRun: boolean,
  actorUserId: number | string | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const i of group) {
      await client.query(
        `UPDATE channel_listings
            SET last_push_status = 'failed', last_push_error = $2,
                last_push_batch_id = $3, last_pushed_at = now()
          WHERE id = $1`,
        [i.listingId, error?.slice(0, 500) ?? null, batchId],
      );
      await insertPushLog(client, {
        listingId: i.listingId, productId: i.productId, externalId: i.externalId,
        prev: i.prev, newQty: i.desired, mode: dryRun ? "dry_run" : "live",
        result, batchId, error: error?.slice(0, 500) ?? null, actorUserId,
      });
    }
    await client.query("COMMIT");
  } catch (err) { await rollbackQuietly(client); throw toServiceError(err); } finally { client.release(); }
}

// Doğrulanmış sonuçları yaz: success → last_pushed güncellenir (change-only artık
// no-op); failed/pending → last_pushed DOKUNULMAZ (retry), durum + log yazılır.
async function applyVerifiedResults(
  group: PushPlanItem[],
  batchId: string,
  verdicts: Map<string, { verdict: ItemVerdict; error: string | null }>,
  actorUserId: number | string | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const i of group) {
      const v = verdicts.get(i.externalId) ?? { verdict: "pending" as ItemVerdict, error: null };
      if (v.verdict === "success") {
        await client.query(
          `UPDATE channel_listings
              SET last_pushed_quantity = $2, last_push_status = 'success',
                  last_push_error = NULL, last_push_batch_id = $3, last_pushed_at = now()
            WHERE id = $1`,
          [i.listingId, i.desired, batchId],
        );
      } else {
        const status = v.verdict === "failed" ? "failed" : "pending";
        await client.query(
          `UPDATE channel_listings
              SET last_push_status = $2, last_push_error = $3,
                  last_push_batch_id = $4, last_pushed_at = now()
            WHERE id = $1`,
          [i.listingId, status, v.error, batchId],
        );
      }
      const logResult = v.verdict === "success" ? "success" : v.verdict === "failed" ? "failed" : "submitted";
      await insertPushLog(client, {
        listingId: i.listingId, productId: i.productId, externalId: i.externalId,
        prev: i.prev, newQty: i.desired, mode: "live", result: logResult,
        batchId, error: v.error, actorUserId,
      });
    }
    await client.query("COMMIT");
  } catch (err) { await rollbackQuietly(client); throw toServiceError(err); } finally { client.release(); }
}

// ── Durum / önizleme (UI; salt-okuma, kilit YOK) ────────────────────────────
export type StockPushStatusItem = {
  listingId: string; productId: string; productName: string | null; externalId: string;
  isBundle: boolean; isListed: boolean; baselined: boolean;
  effective: number; lastPushed: number | null; desired: number; delta: number | null;
  changed: boolean; lastPushStatus: string | null; lastPushError: string | null;
  lastPushedAt: string | null; lastPushBatchId: string | null;
};

export type StockPushStatus = {
  settings: { enabled: boolean; dryRun: boolean };
  summary: {
    totalListings: number; baselined: number; notBaselined: number;
    eligible: number; changed: number; failed: number;
  };
  preview: StockPushStatusItem[]; // değişecek (eligible + changed) kalemler
  errors: StockPushStatusItem[];  // last_push_status='failed'
};

export async function getStockPushStatus(): Promise<StockPushStatus> {
  const settings = await getSettings();

  const res = await pool.query<{
    listing_id: string; product_id: string; product_name: string | null; external_id: string;
    is_listed: boolean; baselined_at: string | null; last_pushed_quantity: number | null;
    last_push_status: string | null; last_push_error: string | null;
    last_pushed_at: string | null; last_push_batch_id: string | null;
    archived_at: string | null; is_bundle: boolean; effective: number;
  }>(
    `SELECT cl.id AS listing_id, cl.product_id, p.name AS product_name, cl.external_id,
            cl.is_listed, cl.baselined_at, cl.last_pushed_quantity,
            cl.last_push_status, cl.last_push_error, cl.last_pushed_at, cl.last_push_batch_id,
            p.archived_at, p.is_bundle,
            COALESCE(es.on_hand, 0)::int AS effective
       FROM channel_listings cl
       JOIN products p ON p.id = cl.product_id
       LEFT JOIN v_product_effective_stock es ON es.product_id = cl.product_id
      WHERE cl.channel = 'trendyol'
      ORDER BY p.name ASC, cl.id ASC`,
  );

  let baselined = 0, notBaselined = 0, eligible = 0, changedCount = 0, failed = 0;
  const preview: StockPushStatusItem[] = [];
  const errors: StockPushStatusItem[] = [];

  for (const r of res.rows) {
    const isBaselined = r.baselined_at !== null;
    if (isBaselined) baselined += 1; else notBaselined += 1;

    const effective = Number(r.effective);
    const desired = computeDesiredQuantity(effective);
    const prev = r.last_pushed_quantity === null ? null : Number(r.last_pushed_quantity);
    const isEligible = r.archived_at === null && isBaselined && r.is_listed === true;
    const changed = isEligible && (prev === null || desired !== prev);
    if (isEligible) eligible += 1;
    if (changed) changedCount += 1;

    const item: StockPushStatusItem = {
      listingId: r.listing_id, productId: r.product_id, productName: r.product_name,
      externalId: r.external_id, isBundle: r.is_bundle === true, isListed: r.is_listed === true,
      baselined: isBaselined, effective, lastPushed: prev, desired,
      delta: prev === null ? null : desired - prev, changed,
      lastPushStatus: r.last_push_status, lastPushError: r.last_push_error,
      lastPushedAt: r.last_pushed_at, lastPushBatchId: r.last_push_batch_id,
    };
    if (changed) preview.push(item);
    if (r.last_push_status === "failed") { failed += 1; errors.push(item); }
  }

  return {
    settings: { enabled: settings.marketplaceStockPushEnabled, dryRun: settings.marketplaceStockPushDryRun },
    summary: {
      totalListings: res.rows.length, baselined, notBaselined,
      eligible, changed: changedCount, failed,
    },
    preview,
    errors,
  };
}
