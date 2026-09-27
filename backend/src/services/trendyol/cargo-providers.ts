// v1.6 — Trendyol pazaryeri kargo firmaları (Change Cargo Provider whitelist'i).
//
// `code` TY'ye gönderilir, `name` yalnız UI etiketidir. `aliases`, TY sipariş
// yanıtındaki serbest firma ADINDAN (cargoProviderName, ör. "Yurtiçi Kargo
// Marketplace", "PTT Kargo Marketplace") kodu tanımak için kullanılan bütün-kelime
// eşleşmeleridir; kargo değişikliğinin TY'ye gerçekten yansıdığı bununla doğrulanır
// (bkz. cargo-change-tracker.ts). Alias'lar foldCargoName ile katlanmış (küçük harf,
// Türkçe karakterler ASCII) yazılır.
//
// Kaynak: developers.trendyol.com changeCargoProvider enum'u (2026-09). MNGMP ve
// SENDEOMP artık enum'da YOK (MNG → DHL eCommerce) — gönderilirse TY 400 döner, bu
// yüzden listeden çıkarıldı. CEVATEDARIK (tedarik akışına özel) bilinçli olarak yok.
// Frontend src/marketplaceOrders.js CARGO_PROVIDERS bu listeyle SENKRON tutulmalı;
// backend güvenlik sınırıdır (tanımsız kod 422).

export type CargoProvider = { code: string; name: string; aliases: readonly string[] };

export const TRENDYOL_CARGO_PROVIDERS: ReadonlyArray<CargoProvider> = [
  { code: "YKMP", name: "Yurtiçi Kargo", aliases: ["yurtici"] },
  { code: "ARASMP", name: "Aras Kargo", aliases: ["aras"] },
  { code: "SURATMP", name: "Sürat Kargo", aliases: ["surat"] },
  { code: "HOROZMP", name: "Horoz Kargo", aliases: ["horoz"] },
  { code: "PTTMP", name: "PTT Kargo", aliases: ["ptt"] },
  { code: "CEVAMP", name: "CEVA Kargo", aliases: ["ceva"] },
  { code: "TEXMP", name: "Trendyol Express", aliases: ["trendyol express", "tex"] },
  { code: "DHLECOMMP", name: "DHL eCommerce", aliases: ["dhl"] },
  { code: "KOLAYGELSINMP", name: "Kolay Gelsin", aliases: ["kolay gelsin", "kolaygelsin"] },
];

const PROVIDER_BY_CODE = new Map(TRENDYOL_CARGO_PROVIDERS.map(p => [p.code, p]));

export function isValidCargoProviderCode(code: string): boolean {
  return PROVIDER_BY_CODE.has(code);
}

export function cargoProviderName(code: string): string | null {
  return PROVIDER_BY_CODE.get(code)?.name ?? null;
}

// "YURTİÇİ Kargo" / "Yurtici-Kargo" → "yurtici kargo". Türkçe büyük/küçük harf
// farkları (İ/ı) ve aksanlar eşleşmeyi bozmasın diye ASCII'ye katlanır.
export function foldCargoName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// TY firma adı → whitelist kodu (tanınmazsa null). Bütün-kelime eşleşmesi: "aras"
// yalnız ayrı bir kelime olarak geçerse eşleşir.
export function cargoProviderCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const padded = ` ${foldCargoName(name)} `;
  const hit = TRENDYOL_CARGO_PROVIDERS.find(p => p.aliases.some(a => padded.includes(` ${a} `)));
  return hit ? hit.code : null;
}
