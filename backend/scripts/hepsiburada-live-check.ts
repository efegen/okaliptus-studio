// Hepsiburada canlı bağlantı kontrolü — YALNIZ OKUMA (yalnız GET istekleri).
// Hiçbir şey yazmaz: fiyat/stok değiştirmez, paketlemez, iptal etmez.
//
// Kullanım (backend/ içinde):  npm run hb:live-check
//
// Kimlik backend/.env'den okunur (HEPSIBURADA_*). Gizli anahtar ekrana basılmaz.
// Müşteri adı/adresi de basılmaz; yalnız sayılar, durumlar ve sipariş/ürün kodları.

import { env } from "../src/config/env.js";
import {
  HepsiburadaApiError,
  getFinanceTransactions,
  getListings,
  getPackages,
  hepsiburadaBaseUrl,
  isHepsiburadaConfigured,
} from "../src/services/hepsiburada/client.js";

type Check = { name: string; host: string; run: () => Promise<void> };

const day = (d: Date) => d.toISOString().slice(0, 10);

async function listingsCheck(): Promise<void> {
  const res = await getListings({ offset: 0, limit: 10 });
  const rows = res.data.listings ?? [];
  console.log(`  ✔ HTTP ${res.status} — toplam listing: ${res.data.totalCount ?? "?"}`);
  for (const l of rows) {
    console.log(
      `    • ${l.hepsiburadaSku ?? "-"} | ${l.merchantSku ?? "-"} | fiyat ${l.price ?? "-"} | stok ${l.availableStock ?? "-"} | ${l.isSalable ? "satışta" : "satışa kapalı"}${l.isLocked ? " | KİLİTLİ" : ""}`,
    );
  }
}

async function packagesCheck(): Promise<void> {
  const res = await getPackages({ limit: 50 });
  const rows = Array.isArray(res.data) ? res.data : [];
  console.log(`  ✔ HTTP ${res.status} — paketlenmiş (kargoya hazır) paket: ${rows.length}`);
  for (const p of rows) {
    const items = (p.items ?? [])
      .map((i) => `${i.orderNumber ?? "-"} ${i.merchantSku ?? i.sku ?? ""}×${i.quantity ?? "?"}`)
      .join(", ");
    console.log(`    • paket ${p.packageNumber ?? "-"} | ${p.status ?? "-"} | ${p.cargoCompany ?? "-"} | ${items}`);
  }
}

async function financeCheck(): Promise<void> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const res = await getFinanceTransactions({ recordDateStart: day(start), recordDateEnd: day(end), limit: 100 });
  const data = (res.data ?? {}) as { count?: number; totalCount?: number; items?: Array<Record<string, unknown>> };
  const items = Array.isArray(data.items) ? data.items : [];
  console.log(
    `  ✔ HTTP ${res.status} — son 30 gün (${day(start)} – ${day(end)}) kayıt: ${data.totalCount ?? data.count ?? items.length}`,
  );
  const byType = new Map<string, number>();
  for (const it of items) {
    const t = String(it.transactionType ?? it.TransactionType ?? "?");
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  if (byType.size) {
    console.log(`    türler (ilk ${items.length}): ${[...byType].map(([t, n]) => `${t} ${n}`).join(" · ")}`);
    console.log(`    kayıt alanları: ${Object.keys(items[0] ?? {}).join(", ")}`);
  }
}

async function main(): Promise<void> {
  if (!isHepsiburadaConfigured()) {
    console.error("\n✖ backend/.env içinde HEPSIBURADA_MERCHANT_ID, HEPSIBURADA_SECRET_KEY ve HEPSIBURADA_USER_AGENT dolu olmalı.\n");
    process.exit(1);
  }
  console.log(
    `Hepsiburada ${env.hepsiburadaEnv === "prod" ? "CANLI" : "TEST (SIT)"} · merchant ${env.hepsiburadaMerchantId.slice(0, 8)}… · user-agent ${env.hepsiburadaUserAgent} · yalnız okuma\n`,
  );

  const checks: Check[] = [
    { name: "Listeleme — ilanlar", host: hepsiburadaBaseUrl("listing"), run: listingsCheck },
    { name: "Sipariş — paketler", host: hepsiburadaBaseUrl("orders"), run: packagesCheck },
    { name: "Muhasebe — kayıtlar", host: hepsiburadaBaseUrl("finance"), run: financeCheck },
  ];

  let failed = 0;
  for (const c of checks) {
    console.log(`→ ${c.name} (${c.host})`);
    try {
      await c.run();
    } catch (err) {
      failed += 1;
      if (err instanceof HepsiburadaApiError) {
        console.log(
          `  ✖ HTTP ${err.upstreamStatus} — ${err.message}${err.correlationId ? ` · x-correlation-id ${err.correlationId}` : ""}`,
        );
      } else {
        console.log(`  ✖ ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log("");
  }
  console.log(failed ? `${failed}/${checks.length} kontrol başarısız.` : `Tüm kontroller geçti (${checks.length}/${checks.length}).`);
  process.exit(failed ? 1 : 0);
}

void main();
