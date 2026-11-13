// Web sitesi mağazası — otomatik yenileme (saatte bir, süreç-içi).
//
// 1. Trendyol ürün listesi (channel_products) SITE_SYNC_INTERVAL_HOURS'tan
//    (varsayılan 24) eskiyse yenilenir. Bu, "Senkronize et" ile aynı salt-okuma
//    çağrısıdır; marketplace_sync_enabled kapalıysa ya da Trendyol kimliği
//    yoksa atlanır. Trendyol boş liste döndürür ama bizde ürün varsa liste
//    KORUNUR (anlık bir arıza siteyi boşaltmasın).
// 2. Sitenin göreceği listenin (getSiteFeed) parmak izi çıkarılır. Fiyat, ad,
//    görsel, köşe, gizleme ya da stok durumu değiştiyse parmak izi değişir.
// 3. Değişiklik henüz bildirilmediyse ve SITE_DEPLOY_HOOK_URL tanımlıysa
//    (yalnız Cloudflare Pages build adresi kabul edilir) siteye "yeniden build
//    et" denir. Liste boşsa ASLA bildirilmez: boş bir mağaza yayına çıkmaz.
//
// Durum site_feed_state'te (0293). Tek süreç varsayımı (order-poller gibi).

import { createHash } from "node:crypto";

import { pool } from "../db/connection.js";
import { getSettings } from "./settings.service.js";
import {
  getApprovedProducts,
  isTrendyolConfigured,
  type GetApprovedProductsParams,
  type TrendyolProductsResponse,
} from "./trendyol/client.js";
import { syncTrendyolProducts } from "./trendyol/channel-sync.service.js";
import { getSiteFeed } from "./site-catalog.service.js";

const HOUR = 3_600_000;

/** Trendyol listesinin en fazla ne kadar eski kalabileceği (ms); 0 = otomatik yenileme kapalı. */
export function siteSyncIntervalMs(): number {
  const hours = Number.parseFloat(process.env.SITE_SYNC_INTERVAL_HOURS ?? "24");
  return Number.isFinite(hours) && hours > 0 ? hours * HOUR : 0;
}

/** Kontrol aralığı (ms); 0 = zamanlayıcı hiç başlamaz. */
export function siteRefreshCheckMs(): number {
  const ms = Number.parseInt(process.env.SITE_REFRESH_CHECK_MS ?? String(HOUR), 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * Sitenin build adresi. Yalnız Cloudflare Pages deploy hook'u kabul edilir
 * (https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/…);
 * başka her değer yok sayılır. Adres gizlidir: loglanmaz.
 */
export function siteDeployHookUrl(): string | null {
  const raw = (process.env.SITE_DEPLOY_HOOK_URL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol === "https:" &&
      url.hostname === "api.cloudflare.com" &&
      url.pathname.startsWith("/client/v4/pages/webhooks/deploy_hooks/")
    ) {
      return url.toString();
    }
  } catch {
    // geçersiz adres → yok say
  }
  return null;
}

export class EmptyTrendyolListError extends Error {
  constructor() {
    super("Trendyol boş ürün listesi döndü; mevcut liste korundu.");
  }
}

type FetchPage = (params: GetApprovedProductsParams) => Promise<TrendyolProductsResponse>;

/**
 * "Senkronize et" ile aynı yenileme; tek fark: bizde ürün varken Trendyol'un
 * ilk sayfası boş gelirse hiçbir şey yazılmadan durur.
 */
export async function guardedProductSync(fetchPage: FetchPage = getApprovedProducts) {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM channel_products WHERE channel = 'trendyol'",
  );
  const existing = rows[0]?.n ?? 0;
  return syncTrendyolProducts({
    fetchPage: async (params) => {
      const resp = await fetchPage(params);
      if ((params.page ?? 0) === 0 && existing > 0 && (resp.content ?? []).length === 0) {
        throw new EmptyTrendyolListError();
      }
      return resp;
    },
  });
}

export type SiteRefreshDeps = {
  now?: () => Date;
  isConfigured?: () => boolean;
  fetchPage?: FetchPage;
  callHook?: (url: string) => Promise<void>;
};

export type SiteRefreshResult = {
  synced: boolean;
  syncError: string | null;
  changed: boolean;
  hookCalled: boolean;
  hookError: string | null;
  productCount: number;
};

async function defaultCallHook(url: string): Promise<void> {
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`build adresi HTTP ${res.status} döndü`);
}

type StateRow = { fingerprint: string | null; changed_at: Date | null; hook_called_at: Date | null };

export async function runSiteRefresh(deps: SiteRefreshDeps = {}): Promise<SiteRefreshResult> {
  const now = (deps.now ?? (() => new Date()))();
  const result: SiteRefreshResult = {
    synced: false,
    syncError: null,
    changed: false,
    hookCalled: false,
    hookError: null,
    productCount: 0,
  };

  // 1. Trendyol listesi eskiyse yenile.
  const interval = siteSyncIntervalMs();
  const settings = await getSettings();
  const configured = (deps.isConfigured ?? isTrendyolConfigured)();
  if (interval > 0 && settings.marketplaceSyncEnabled && configured) {
    const { rows } = await pool.query<{ at: Date | null }>(
      "SELECT max(synced_at) AS at FROM channel_products WHERE channel = 'trendyol'",
    );
    const last = rows[0]?.at ?? null;
    if (!last || now.getTime() - last.getTime() >= interval) {
      try {
        await guardedProductSync(deps.fetchPage);
        result.synced = true;
        await pool.query("UPDATE site_feed_state SET last_sync_at = $1, last_sync_error = NULL WHERE id = 1", [now]);
      } catch (err) {
        result.syncError = err instanceof Error ? err.message : String(err);
        await pool.query("UPDATE site_feed_state SET last_sync_error = $1 WHERE id = 1", [result.syncError.slice(0, 500)]);
      }
    }
  }

  // 2. Sitenin göreceği listenin parmak izi.
  const feed = await getSiteFeed();
  result.productCount = feed.products.length;
  const fingerprint = createHash("sha256").update(JSON.stringify(feed.products)).digest("hex");
  const state = (await pool.query<StateRow>(
    "SELECT fingerprint, changed_at, hook_called_at FROM site_feed_state WHERE id = 1",
  )).rows[0];
  let changedAt = state?.changed_at ?? null;
  if (state?.fingerprint !== fingerprint) {
    result.changed = true;
    changedAt = now;
    await pool.query(
      "UPDATE site_feed_state SET fingerprint = $1, product_count = $2, changed_at = $3 WHERE id = 1",
      [fingerprint, feed.products.length, now],
    );
  }

  // 3. Bildirilmemiş değişiklik varsa siteyi yeniden build ettir.
  const hook = siteDeployHookUrl();
  const pending = changedAt !== null && (!state?.hook_called_at || state.hook_called_at < changedAt);
  if (hook && pending && feed.products.length > 0) {
    try {
      await (deps.callHook ?? defaultCallHook)(hook);
      result.hookCalled = true;
      await pool.query("UPDATE site_feed_state SET hook_called_at = $1 WHERE id = 1", [now]);
    } catch (err) {
      result.hookError = err instanceof Error ? err.message : String(err);
    }
  }

  return result;
}

// ─── Zamanlayıcı ─────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let firstRun: ReturnType<typeof setTimeout> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await runSiteRefresh();
    if (r.synced || r.syncError || r.changed || r.hookCalled || r.hookError) {
      console.log(
        `[site-refresh] ürün=${r.productCount} yenilendi=${r.synced} değişti=${r.changed} ` +
          `build=${r.hookCalled}${r.syncError ? ` senkron hatası: ${r.syncError}` : ""}` +
          `${r.hookError ? ` build hatası: ${r.hookError}` : ""}`,
      );
    }
  } catch (err) {
    // Defansif: hata süreci düşürmez.
    console.error("[site-refresh] hata:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startSiteRefreshScheduler(): void {
  if (timer) return;
  const ms = siteRefreshCheckMs();
  if (!ms) {
    console.log("[site-refresh] devre dışı (SITE_REFRESH_CHECK_MS=0).");
    return;
  }
  // İlk bakış açılıştan 1 dk sonra (deploy sırasında yük bindirmesin).
  firstRun = setTimeout(() => void tick(), 60_000);
  timer = setInterval(() => void tick(), ms);
  if (typeof firstRun.unref === "function") firstRun.unref();
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[site-refresh] başladı (her ${Math.round(ms / 60_000)} dk).`);
}

export function stopSiteRefreshScheduler(): void {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  firstRun = null;
  timer = null;
}
