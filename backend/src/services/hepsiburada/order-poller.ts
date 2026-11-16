// Hepsiburada sipariş listesi ısıtıcısı (in-process, singleton).
//
// Trendyol poller'ının (trendyol/order-poller.ts) sipariş-listesi ayağının HB eşi:
// HEPSIBURADA_ORDER_POLL_MS'te bir (varsayılan ~3 dk) Siparişler ekranının HB
// snapshot'ını tazeler → ekran açılışı anında olur ve "yeni sipariş" bildirimi
// (channel_order_sightings) beslenir. SALT-OKUMA: HB'ye yazmaz, stoğa dokunmaz.
// Flag (marketplaceSyncEnabled) her tick'te okunur; kapalıyken sessizce atlar.
// Hata asla süreci düşürmez.

import { env } from "../../config/env.js";
import { getSettings } from "../settings.service.js";
import { isHepsiburadaConfigured } from "./client.js";
import { warmHepsiburadaOrders } from "./orders.service.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!isHepsiburadaConfigured()) return;
    const settings = await getSettings();
    if (settings.marketplaceSyncEnabled) await warmHepsiburadaOrders();
  } catch (err) {
    console.error("[hb-poll] hata:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startHepsiburadaOrderPoller(): void {
  if (timer) return;
  const ms = env.hepsiburadaOrderPollMs;
  if (!ms || ms <= 0) {
    console.log("[hb-poll] devre dışı (HEPSIBURADA_ORDER_POLL_MS=0).");
    return;
  }
  if (!isHepsiburadaConfigured()) {
    console.log("[hb-poll] Hepsiburada kimliği yok; poller başlatılmadı.");
    return;
  }
  timer = setInterval(() => {
    void tick();
  }, ms);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[hb-poll] başladı (her ${Math.round(ms / 1000)}sn, ${env.hepsiburadaEnv === "prod" ? "canlı" : "test"} ortam).`);
}

export function stopHepsiburadaOrderPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
