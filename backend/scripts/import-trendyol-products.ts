// Trendyol satıcı paneli "Ürünleri İndir" Excel export'unu products tablosuna
// upsert eder. Resimler için Görsel 1 kolonundaki CDN URL'i (cdn.dsmcdn.com)
// olduğu gibi saklanır — backend dosya host'u yapmıyor.
//
// Kullanım:
//   cd backend
//   npm run import:trendyol -- /path/to/trendyol-export.xlsx
//   # veya alternatif sheet adı için:
//   npm run import:trendyol -- /path/to/file.xlsx "Sayfa1"
//
// Beklenen kolonlar (Trendyol'un standart export'u — header row'dan eşleşir):
//   - Barkod                              (zorunlu, UNIQUE anahtar)
//   - Ürün Adı                            (zorunlu)
//   - Piyasa Satış Fiyatı (KDV Dahil)     (zorunlu, sayısal)
//   - Görsel 1                            (opsiyonel, public URL)
//   - Model Kodu                          (opsiyonel, varyant grup anahtarı)
//   - Ürün Rengi / Beden / Boyut/Ebat /
//     Cinsiyet                            (opsiyonel, variant_label'e birleşir)
//   - Kategori İsmi                       (opsiyonel, products.category)
//
// Davranış: barkod ile UPSERT. name/price/parent_product_code/variant_label/
// category her zaman güncellenir; image_url, ty_listing_url COALESCE ile boş
// ise atanır (kullanıcı yerelde elle düzenlediyse korunur). archived_at
// sıfırlanır. Yeni ürünler oluşturulur.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

import { pool } from "../src/db/connection.js";
import { upsertProductByBarcode } from "../src/services/products.service.js";

type RawRow = Record<string, unknown>;

function getCellRaw(row: RawRow, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = row[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return v;
    }
  }
  return null;
}

function getCell(row: RawRow, ...keys: string[]): string {
  const v = getCellRaw(row, ...keys);
  return v === null ? "" : String(v).trim();
}

// Excel sheet_to_json varsayılanda numeric hücreleri JS number olarak döner;
// raw'ı doğrudan kullan ki "129.0" → "1290" tuzağına düşmeyelim. String geldiğinde
// (örn. metne dönüştürülmüş hücre) ayraç heuristiği:
//   "1.290,50" → 1290.50  (TR: nokta binlik, virgül ondalık)
//   "1290,50"  → 1290.50  (TR: virgül ondalık)
//   "289.99"   → 289.99   (US: nokta ondalık — 1-2 hane fraksiyon)
//   "129.0"    → 129.0    (US: nokta ondalık — 1 hane fraksiyon)
//   "1.290"    → 1290     (TR: nokta binlik — tam 3 hane sonra)
function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const str = String(raw).trim();
  if (!str) return null;

  const hasComma = str.includes(",");
  const hasDot = str.includes(".");
  let normalized: string;

  if (hasComma && hasDot) {
    normalized = str.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = str.replace(",", ".");
  } else if (hasDot) {
    const parts = str.split(".");
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      // "1.290" gibi → binlik ayracı (TR formatı)
      normalized = parts.join("");
    } else {
      // "289.99" / "129.0" → ondalık (US formatı)
      normalized = str;
    }
  } else {
    normalized = str;
  }

  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  const sheetNameArg = process.argv[3];

  if (!filePath) {
    console.error("Kullanım: npm run import:trendyol -- /path/to/export.xlsx [SheetName]");
    process.exit(1);
  }

  const absPath = resolve(filePath);
  const buffer = readFileSync(absPath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = sheetNameArg || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    console.error(`Sheet bulunamadı: ${sheetName}. Mevcut: ${workbook.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
  console.log(`📄 ${rows.length} satır okundu (${sheetName}).`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ row: number; barcode: string; reason: string }> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const rowNum = i + 2; // header + 1-indexed

    const barcode = getCell(row, "Barkod");
    const name = getCell(row, "Ürün Adı", "Urun Adi");
    const priceRaw = getCellRaw(
      row,
      "Piyasa Satış Fiyatı (KDV Dahil)",
      "Piyasa Satis Fiyati (KDV Dahil)",
      "Trendyol'da Satılacak Fiyat (KDV Dahil)",
    );
    const imageUrl = getCell(row, "Görsel 1", "Gorsel 1") || null;

    // Varyant + kategori metadata — hepsi opsiyonel.
    const parentProductCode = getCell(row, "Model Kodu") || null;
    const category = getCell(row, "Kategori İsmi", "Kategori Ismi") || null;

    // variant_label: Renk / Beden / Boyut / Cinsiyet eksenlerini "·" ile birleştir.
    // Sadece dolu olanları al, "STD" / "Standart" gibi placeholder'ları at.
    const variantParts = [
      getCell(row, "Ürün Rengi", "Urun Rengi"),
      getCell(row, "Beden"),
      getCell(row, "Boyut/Ebat", "Boyut", "Ebat"),
      getCell(row, "Cinsiyet"),
    ]
      .map(s => s.trim())
      .filter(s => s.length > 0 && !/^(std|standart)$/i.test(s));
    const variantLabel = variantParts.length > 0 ? variantParts.join(" · ") : null;

    if (!barcode) {
      skipped += 1;
      errors.push({ row: rowNum, barcode: "", reason: "barkod boş" });
      continue;
    }
    if (!name) {
      skipped += 1;
      errors.push({ row: rowNum, barcode, reason: "ad boş" });
      continue;
    }
    const price = parsePrice(priceRaw);
    if (price === null) {
      skipped += 1;
      errors.push({ row: rowNum, barcode, reason: `geçersiz fiyat: "${String(priceRaw)}"` });
      continue;
    }

    try {
      const result = await upsertProductByBarcode({
        barcode,
        name,
        price,
        imageUrl,
        parentProductCode,
        variantLabel,
        category,
      });
      if (result.created) created += 1;
      else updated += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ row: rowNum, barcode, reason: msg });
      skipped += 1;
    }
  }

  console.log("");
  console.log(`✅ Eklenen:    ${created}`);
  console.log(`🔄 Güncellenen: ${updated}`);
  console.log(`⚠️  Atlanan:    ${skipped}`);
  if (errors.length > 0) {
    console.log("\nHata satırları:");
    for (const e of errors.slice(0, 20)) {
      console.log(`  satır ${e.row}: barkod="${e.barcode}" → ${e.reason}`);
    }
    if (errors.length > 20) {
      console.log(`  … ve ${errors.length - 20} satır daha`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error("Import başarısız:", err);
  pool.end().finally(() => process.exit(1));
});
