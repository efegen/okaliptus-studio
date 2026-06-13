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

let timer: ReturnType<typeof setInterval> | null = null;
let running = false; // süreç-içi üst üste binme koruması

async function tick(): Promise<void> {
  if (running) return; // önceki tick hâlâ sürüyor
  running = true;
  try {
    if (!isTrendyolConfigured()) return;
    const settings = await getSettings();
    if (!settings.marketplaceOrdersEnabled) return; // flag kapalı → sessizce atla

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
