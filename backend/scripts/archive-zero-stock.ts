// Trendyol satıcı paneli "Ürünleri İndir" Excel export'undan SADECE stoğu
// sıfır olan ürünleri arşivler. İsim/fiyat/kategori/varyant gibi alanlara
// DOKUNMAZ — kullanıcının elle yaptığı düzenlemeler korunur.
//
// Use case: Trendyol'da bir ürün stoğu tükendi; bizim katalogdan da
// gizlemek istiyorsun ama tek tek arşivlemek zahmetli, full re-import da
// elle yaptığın isim/kategori değişikliklerini siliyor.
//
// Kullanım:
//   cd backend
//   npm run archive:zero-stock -- /path/to/trendyol-export.xlsx
//   # alternatif sheet adı için:
//   npm run archive:zero-stock -- /path/to/file.xlsx "Sayfa1"
//
// Beklenen kolonlar:
//   - Barkod              (zorunlu, eşleşme anahtarı)
//   - Ürün Stok Adedi     (zorunlu, tam sayı; 0 → arşiv)
//
// Davranış:
//   - Stok > 0  → atla.
//   - Stok 0    → barkodla DB'de ara:
//       * bulunamadı   → atla, raporla
//       * zaten arşivli → atla, raporla
//       * aktif        → archiveProduct() çağır (audit log dahil).
//   - Hiçbir başka kolon okunmaz/yazılmaz.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

import { pool } from "../src/db/connection.js";
import { archiveProduct } from "../src/services/products.service.js";

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

// Stok hücresi number ya da string olabilir (Excel formatına bağlı). 0 ve
// non-zero ayrımı için tam sayıya çevir; boş/parse edilemeyen → null (atla).
function parseStock(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.trunc(raw) : null;
  }
  const str = String(raw).trim().replace(/\./g, "").replace(",", ".");
  if (!str) return null;
  const n = Number.parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

async function findProductByBarcode(barcode: string): Promise<{ id: string | number; archivedAt: string | null } | null> {
  const r = await pool.query<{ id: string | number; archived_at: string | null }>(
    `SELECT id, archived_at FROM products WHERE barcode = $1 LIMIT 1`,
    [barcode],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, archivedAt: row.archived_at };
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  const sheetNameArg = process.argv[3];

  if (!filePath) {
    console.error("Kullanım: npm run archive:zero-stock -- /path/to/export.xlsx [SheetName]");
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

  let archived = 0;
  let alreadyArchived = 0;
  let notFound = 0;
  let inStock = 0;
  let skippedInvalid = 0;
  const issues: Array<{ row: number; barcode: string; reason: string }> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const rowNum = i + 2; // header + 1-indexed

    const barcode = getCell(row, "Barkod");
    const stockRaw = getCellRaw(row, "Ürün Stok Adedi", "Urun Stok Adedi");

    if (!barcode) {
      skippedInvalid += 1;
      issues.push({ row: rowNum, barcode: "", reason: "barkod boş" });
      continue;
    }

    const stock = parseStock(stockRaw);
    if (stock === null) {
      skippedInvalid += 1;
      issues.push({ row: rowNum, barcode, reason: `stok parse edilemedi: "${String(stockRaw)}"` });
      continue;
    }

    if (stock > 0) {
      inStock += 1;
      continue;
    }

    // stock === 0 (negatif gelirse de aynı muamele — Trendyol negatif stok döndürmez)
    try {
      const found = await findProductByBarcode(barcode);
      if (!found) {
        notFound += 1;
        issues.push({ row: rowNum, barcode, reason: "DB'de bulunamadı" });
        continue;
      }
      if (found.archivedAt !== null) {
        alreadyArchived += 1;
        continue;
      }
      await archiveProduct(found.id, null);
      archived += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skippedInvalid += 1;
      issues.push({ row: rowNum, barcode, reason: msg });
    }
  }

  console.log("");
  console.log(`📦 Stoğu var (atlandı):  ${inStock}`);
  console.log(`🗄️  Arşivlendi:          ${archived}`);
  console.log(`✓  Zaten arşivliydi:    ${alreadyArchived}`);
  console.log(`❓ DB'de yok:           ${notFound}`);
  console.log(`⚠️  Geçersiz satır:      ${skippedInvalid}`);
  if (issues.length > 0) {
    console.log("\nDetay:");
    for (const e of issues.slice(0, 30)) {
      console.log(`  satır ${e.row}: barkod="${e.barcode}" → ${e.reason}`);
    }
    if (issues.length > 30) {
      console.log(`  … ve ${issues.length - 30} satır daha`);
    }
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  void pool.end();
  process.exit(1);
});
