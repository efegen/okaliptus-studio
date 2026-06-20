// v1.6 — Tek seferlik Trendyol kanal listing seed'i.
//
// Barkodu OLAN her ürün için bir 'trendyol' channel_listing oluşturur:
//   external_id = barcode
//   is_listed   = (ty_listing_url IS NOT NULL)
//   channel_price = NULL  (kanal fiyatı elle girilir)
//
// Idempotent: UNIQUE (channel, external_id) çakışırsa ON CONFLICT DO NOTHING ile
// atlanır; tekrar koşmak güvenlidir, mevcut kayıtları değiştirmez.
//
// Hepsiburada için seed YOK — merchantSku elimizde yok, elle girilecek.
//
// Bu script HİÇBİR dış API çağrısı yapmaz; yalnız yerel DB'yi okur/yazar.
//
// Kullanım:
//   cd backend && npm run seed:trendyol-listings
//   # önizleme (yazma yok):
//   cd backend && npm run seed:trendyol-listings -- --dry-run

import { pool } from "../src/db/connection.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const candidates = await pool.query<{ total: string; listed: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE ty_listing_url IS NOT NULL)::text AS listed
       FROM products
      WHERE barcode IS NOT NULL`,
  );
  const total = Number(candidates.rows[0]?.total ?? 0);
  const listed = Number(candidates.rows[0]?.listed ?? 0);
  console.log(`📦 Barkodu olan ürün: ${total} (ty_listing_url dolu: ${listed})`);

  if (dryRun) {
    const existing = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM channel_listings WHERE channel = 'trendyol'`,
    );
    console.log(`ℹ️  Dry-run — yazma yapılmadı. Mevcut trendyol listing: ${existing.rows[0].c}`);
    await pool.end();
    return;
  }

  const inserted = await pool.query(
    `INSERT INTO channel_listings (product_id, channel, external_id, is_listed)
     SELECT id, 'trendyol', barcode, (ty_listing_url IS NOT NULL)
       FROM products
      WHERE barcode IS NOT NULL
     ON CONFLICT (channel, external_id) DO NOTHING
     RETURNING id`,
  );

  const created = inserted.rowCount ?? 0;
  const skipped = total - created;
  console.log(`✅ Oluşturuldu: ${created}`);
  console.log(`↪️  Atlandı (zaten vardı): ${skipped}`);

  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  void pool.end();
  process.exit(1);
});
