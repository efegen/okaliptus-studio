// Ürünleri JSON yedek dosyasına döker. DB sıfırlanmadan önce / Railway'e
// veri taşımadan önce çalıştır.
//
// Kullanım:
//   cd backend
//   npm run products:export
//   # → backend/data/products-backup.json oluşur

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { pool } from "../src/db/connection.js";

const OUT_PATH = resolve(process.cwd(), "data", "products-backup.json");

async function main(): Promise<void> {
  const result = await pool.query(
    `SELECT id, barcode, name, price, image_url, ty_listing_url, hb_listing_url,
            notes, parent_product_code, variant_label, category, archived_at,
            created_at, updated_at
       FROM products
      ORDER BY id ASC`,
  );

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        count: result.rows.length,
        products: result.rows,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Exported ${result.rows.length} products → ${OUT_PATH}`);
}

main()
  .catch((err) => {
    console.error("Export failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
