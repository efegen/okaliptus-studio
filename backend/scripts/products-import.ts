// products-export.ts'in ürettiği JSON dosyasını DATABASE_URL'in işaret ettiği
// DB'ye upsert eder.
//
// Eşleştirme:
//   - barcode varsa → barkod ile upsert (barcode UNIQUE)
//   - barcode NULL ise → name + parent_product_code + variant_label kombinasyonu
//     ile mevcut bir kayıt aranır; bulunursa update, bulunmazsa insert.
//
// Idempotent — aynı dosyayı tekrar koşmak güvenli.
//
// Kullanım:
//   cd backend
//   # Lokal DB'ye geri yükleme:
//   npm run products:import
//   # Railway'e taşıma:
//   $env:DATABASE_URL = "<railway-public-url>"; npm run products:import

import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pool } from "../src/db/connection.js";

const IN_PATH = resolve(process.cwd(), "data", "products-backup.json");

type BackupProduct = {
  barcode: string | null;
  name: string;
  price: string | number;
  image_url: string | null;
  ty_listing_url: string | null;
  hb_listing_url: string | null;
  notes: string | null;
  parent_product_code: string | null;
  variant_label: string | null;
  category: string | null;
  archived_at: string | null;
};

async function main(): Promise<void> {
  const raw = readFileSync(IN_PATH, "utf8");
  const parsed = JSON.parse(raw) as { products: BackupProduct[] };
  const products = parsed.products ?? [];

  if (products.length === 0) {
    console.log("Backup boş — yapılacak iş yok.");
    return;
  }

  let created = 0;
  let updated = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const p of products) {
      let existingId: string | null = null;

      if (p.barcode) {
        const r = await client.query<{ id: string }>(
          `SELECT id FROM products WHERE barcode = $1 LIMIT 1`,
          [p.barcode],
        );
        existingId = r.rows[0]?.id ?? null;
      } else {
        const r = await client.query<{ id: string }>(
          `SELECT id FROM products
            WHERE barcode IS NULL
              AND name = $1
              AND COALESCE(parent_product_code, '') = COALESCE($2, '')
              AND COALESCE(variant_label, '')       = COALESCE($3, '')
            LIMIT 1`,
          [p.name, p.parent_product_code, p.variant_label],
        );
        existingId = r.rows[0]?.id ?? null;
      }

      if (existingId) {
        await client.query(
          `UPDATE products SET
             barcode = $1,
             name = $2,
             price = $3,
             image_url = $4,
             ty_listing_url = $5,
             hb_listing_url = $6,
             notes = $7,
             parent_product_code = $8,
             variant_label = $9,
             category = $10,
             archived_at = $11
           WHERE id = $12`,
          [
            p.barcode,
            p.name,
            p.price,
            p.image_url,
            p.ty_listing_url,
            p.hb_listing_url,
            p.notes,
            p.parent_product_code,
            p.variant_label,
            p.category,
            p.archived_at,
            existingId,
          ],
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO products (
             barcode, name, price, image_url, ty_listing_url, hb_listing_url, notes,
             parent_product_code, variant_label, category, archived_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            p.barcode,
            p.name,
            p.price,
            p.image_url,
            p.ty_listing_url,
            p.hb_listing_url,
            p.notes,
            p.parent_product_code,
            p.variant_label,
            p.category,
            p.archived_at,
          ],
        );
        created += 1;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(
    `Import tamam: ${created} yeni, ${updated} güncellendi (toplam ${products.length}).`,
  );
}

main()
  .catch((err) => {
    console.error("Import failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
