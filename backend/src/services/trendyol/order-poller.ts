// v1.6 — Model C / Faz 1: Trendyol sipariş poller'ı (in-process, singleton).
//
// Mevcut backend süreci İÇİNDE setInterval ile (~3 dk) çalışır; ayrı worker/cron yok
// (Railway'de süreç uyumadığı sürece ek maliyet ~0). Üç güvence:
//   • Singleton/seri: syncTrendyolOrders global advisory lock alır → çoklu instance
//     ya da üst üste binen tick aynı satıra yazamaz. Ayrıca süreç-içi `running` bayrağı
//     bir tick bitmeden ikincisini başlatmaz.
//   • Idempotent: tekrar gören sipariş no-op (channel_order_lines defteri).
//   • Defansif: poll ASLA süreci düşürmez; ağ/DB hatası loglanır, DB'ye dokunulmaz.
//     Boş yanıt "0 sipariş" demektir, "hepsi iptal/iade" DEĞİL — yalnız GÖRÜLEN satır
//     işlenir; yanıttan düşen satır olduğu gibi bırakılır (yanlışlıkla geri alınmaz).
//
// Flag (marketplace_orders_enabled) ve Trendyol kimliği her tick'te kontrol edilir;
// kapalıyken sessizce atlar (hata loglamaz).

import { env } from "../../config/env.js";
import { getSettings } from "../settings.service.js";
import { isTrendyolConfigured } from "./client.js";
import { syncTrendyolOrders } from "./order-sync.service.js";
import { syncTrendyolClaims } from "./claims-sync.service.js";
import { runStockPush } from "./stock-push.service.js";
import { warmOrdersSnapshot } from "./orders.service.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false; // süreç-içi üst üste binme koruması

// Sipariş senkronu (stok düşür/geri al + eşleşmeyen/iade kuyrukları). Kendi
// try'ında: hata sızmaz, claims senkronunu atlamaz.
async function syncOrdersTick(): Promise<void> {
  try {
    const r = await syncTrendyolOrders();
    // Yalnız bir şey değiştiyse logla (sessiz turlar gürültü yapmasın).
    if (r.unitsDecremented || r.unitsRestored || r.returnPending || r.unmatched) {
      console.log(
        `[trendyol-poll] sipariş=${r.ordersSeen} satır=${r.linesSeen} ` +
          `stok -${r.unitsDecremented}/+${r.unitsRestored}; ` +
          `kuyruk: iade=${r.returnPending} eşleşmeyen=${r.unmatched}`,
      );
    }
  } catch (err) {
    console.error("[trendyol-poll] sipariş hatası:", err instanceof Error ? err.message : err);
  }
}

// İade (claims) senkronu: sayılmış satırları "iade bekliyor"a taşır. Stok YAZMAZ.
async function syncClaimsTick(): Promise<void> {
  try {
    const c = await syncTrendyolClaims();
    if (c.returnsRegistered) {
      console.log(`[trendyol-poll] iade: ${c.returnsRegistered} satır 'iade bekliyor' kuyruğuna taşındı.`);
    }
  } catch (err) {
    console.error("[trendyol-poll] iade hatası:", err instanceof Error ? err.message : err);
  }
}

// Stok push reconcile (Model C / Faz 2): iç efektif stoğu TY'ye yazar. dry-run
// flag'ine SAYGI duyar (runStockPush okur); kapalıyken yalnız plan loglanır, TY'ye
// çağrı YOK. Devre kesici tetiklenirse DURUR (poller force GEÇMEZ → güvenli).
async function syncStockPushTick(): Promise<void> {
  try {
    const r = await runStockPush();
    if (r.mode === "live" && (r.pushedCount || r.failedCount || r.pendingCount)) {
      console.log(
        `[trendyol-poll] stok push: ${r.pushedCount} başarılı, ${r.failedCount} başarısız, ${r.pendingCount} beklemede.`,
      );
    } else if (r.mode === "breaker_tripped") {
      console.warn(
        `[trendyol-poll] stok push DEVRE KESİCİ: ${r.breaker?.dangerousCount} tehlikeli düşüş (%${Math.round((r.breaker?.ratio ?? 0) * 100)}) — DURDU. Eşleştirme'den inceleyip elle onaylayın.`,
      );
    } else if (r.mode === "dry_run" && r.changedCount) {
      console.log(`[trendyol-poll] stok push (dry-run): ${r.changedCount} kalem yazılacaktı (TY'ye gönderilmedi).`);
    }
  } catch (err) {
    console.error("[trendyol-poll] stok push hatası:", err instanceof Error ? err.message : err);
  }
}

// Pazaryeri Siparişleri ekranı (marketplace_sync_enabled umbrella flag) için sipariş
// listesi snapshot'ını arka planda tazeler → kullanıcı ekranı açınca canlı beklemeden
// ANINDA görür. Salt-okunur; DB'ye/stoğa yazmaz. Hata sızmaz (içeride yutulur).
async function warmOrdersTick(): Promise<void> {
  try {
    await warmOrdersSnapshot();
  } catch (err) {
    console.error("[trendyol-poll] sipariş listesi ısıtma hatası:", err instanceof Error ? err.message : err);
  }
}

async function tick(): Promise<void> {
  if (running) return; // önceki tick hâlâ sürüyor
  running = true;
  try {
    if (!isTrendyolConfigured()) return;
    const settings = await getSettings();
    // Sipariş listesi görünümü (umbrella flag). Stok flag'lerinden BAĞIMSIZ: kullanıcı
    // stoğu kapalı tutsa da Pazaryeri Siparişleri ekranı akar → snapshot'ı sıcak tut.
    if (settings.marketplaceSyncEnabled) {
      await warmOrdersTick();
    }
    // Sipariş + iade senkronu (marketplace_orders_enabled). Önce siparişler (yeni
    // satırları say), sonra iadeler (sayılmış satırları kuyruğa taşı) → aynı tick'te
    // yakınsar. İkisi de AYNI advisory lock'u alır (tek-yazar); seri çalışırlar.
    if (settings.marketplaceOrdersEnabled) {
      await syncOrdersTick();
      await syncClaimsTick();
    }
    // Stok push (marketplace_stock_push_enabled). Sipariş senkronundan BAĞIMSIZ:
    // POS satışı da iç stoğu değiştirir → push onu da yansıtmalı. Kendi kilidini
    // (PUSH_LOCK) alır, order-sync ile paralel güvenli.
    if (settings.marketplaceStockPushEnabled) {
      await syncStockPushTick();
    }
  } catch (err) {
    // Defansif: hata asla yukarı sızmaz, süreç ayakta kalır.
    console.error("[trendyol-poll] hata:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startOrderPoller(): void {
  if (timer) return; // zaten başladı
  const ms = env.trendyolOrderPollMs;
  if (!ms || ms <= 0) {
    console.log("[trendyol-poll] devre dışı (TRENDYOL_ORDER_POLL_MS=0).");
    return;
  }
  if (!isTrendyolConfigured()) {
    console.log("[trendyol-poll] Trendyol kimliği yok; poller başlatılmadı.");
    return;
  }
  // İlk tick ms sonra (boot'u yavaşlatma); anlık ihtiyaç manuel uçla karşılanır.
  timer = setInterval(() => {
    void tick();
  }, ms);
  // Timer süreci canlı tutmasın (temiz kapanış).
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[trendyol-poll] başladı (her ${Math.round(ms / 1000)}sn).`);
}

export function stopOrderPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
