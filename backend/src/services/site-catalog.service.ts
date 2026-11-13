// Web sitesi mağazası (okaliptusyoga.com/magaza) — Trendyol ürünlerinden
// sitenin okuyacağı liste ve panelden yönetilen site ayarları.
//
// Kaynak: channel_products snapshot'ı (0243, "Senkronize et" doldurur). Sitenin
// ayarları (gizli / köşe / görünen ad) ayrı tabloda: site_products (0292).
//
// Güvenlik:
//   • Site bu listeyi build sırasında, ayrı bir okuma anahtarıyla (SITE_FEED_TOKEN)
//     çeker. Anahtar yoksa ya da kısaysa uç kapalıdır (404).
//   • Liste yalnız Trendyol'da zaten herkese açık bilgiyi taşır: ad, fiyat, liste
//     fiyatı, ilk görsel, ilan linki, köşe, stokta olup olmadığı. Barkod, model
//     kodu, stok adedi ve iç kimlikler dışarı çıkmaz; kimlik model kodunun özetidir.
//   • Linkler yalnız https://www.trendyol.com, görseller yalnız Trendyol'un görsel
//     sunucusu (dsmcdn.com) ise geçer; başka her adres düşürülür.

import { createHash, timingSafeEqual } from "node:crypto";

import { pool } from "../db/connection.js";
import { AppError, ValidationError } from "./errors.js";

export const SITE_CORNERS = ["arinma", "meditasyon", "taslar", "pratik"] as const;
export type SiteCorner = (typeof SITE_CORNERS)[number];

const MIN_TOKEN_LENGTH = 32;
const MAX_KEY_LENGTH = 200;
const MAX_NAME_LENGTH = 120;

export class SiteProductNotFoundError extends AppError {
  constructor() {
    super("SITE_PRODUCT_NOT_FOUND", "Ürün Trendyol listesinde bulunamadı.", 404);
  }
}

// ─── Anahtar ─────────────────────────────────────────────────────────────────

/** Sitenin okuma anahtarı; tanımsız ya da 32 karakterden kısaysa uç kapalı. */
export function siteFeedToken(): string | null {
  const token = (process.env.SITE_FEED_TOKEN ?? "").trim();
  return token.length >= MIN_TOKEN_LENGTH ? token : null;
}

/** `Authorization: Bearer <anahtar>` başlığını sabit sürede karşılaştırır. */
export function isSiteFeedAuthorized(header: string | undefined, token: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice("Bearer ".length).trim()).digest();
  const expected = createHash("sha256").update(token).digest();
  return timingSafeEqual(given, expected);
}

// ─── Köşe tahmini ────────────────────────────────────────────────────────────

// Türkçe harfleri sadeleştirir: "Tütsülük" → "tutsuluk".
function fold(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}

// Sıra önemli: "Taş Buhurdanlık" buhurdanlık olarak, "Tütsülük" arınma olarak düşer.
const CORNER_RULES: Array<[SiteCorner, RegExp]> = [
  ["meditasyon", /buhurdan|\bmum\b|\bmumu\b|tealight|esans|\byag\b|\byagi\b|samdan|difuzor|oda kokusu/],
  ["arinma", /tutsu|adacayi|palo santo|\bsage\b/],
  ["taslar", /bileklik|kolye|kristal|dogal tas|ametist|kuvars|turkuaz|obsidyen|kaplan gozu|ay tasi|lav tasi/],
  ["pratik", /\bmat\b|\bmati\b|minder|\bblok|kayis|bolster|yastik|havlu|yoga/],
];

/** Trendyol başlığından köşe tahmini; tutmazsa null (panelden seçilir). */
export function guessCorner(title: string): SiteCorner | null {
  const t = fold(title);
  for (const [corner, rule] of CORNER_RULES) {
    if (rule.test(t)) return corner;
  }
  return null;
}

// ─── Güvenli adresler ────────────────────────────────────────────────────────

const LISTING_HOST = /^(www\.)?trendyol\.com$/;
const IMAGE_HOST = /(^|\.)dsmcdn\.com$/;

function safeUrl(raw: string | null, host: RegExp): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !host.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// ─── Gruplama ────────────────────────────────────────────────────────────────

type VariantRow = {
  product_key: string;
  external_id: string;
  title: string | null;
  quantity: number | null;
  list_price: string | null;
  sale_price: string | null;
  on_sale: boolean | null;
  archived: boolean | null;
  product_url: string | null;
  image_url: string | null;
  synced_at: Date;
};

type SettingRow = {
  product_key: string;
  hidden: boolean;
  corner: SiteCorner | null;
  display_name: string | null;
};

export type SiteProduct = {
  key: string;
  /** Trendyol başlığı. */
  title: string;
  /** Panelde girilen site adı; boşsa başlık kullanılır. */
  displayName: string | null;
  /** Sitede görünen ad. */
  name: string;
  hidden: boolean;
  /** Panelden seçilen köşe (null = otomatik). */
  corner: SiteCorner | null;
  /** Başlıktan tahmin edilen köşe. */
  autoCorner: SiteCorner | null;
  /** Sitede kullanılan köşe: seçilen, yoksa tahmin. */
  effectiveCorner: SiteCorner | null;
  /** Trendyol'da satışta en az bir varyantı var. */
  sellable: boolean;
  inStock: boolean;
  price: number | null;
  /** Üstü çizili gösterilecek liste fiyatı; yalnız satış fiyatından yüksekse. */
  listPrice: number | null;
  /** Varyant fiyatları farklı: fiyat en düşüğüdür. */
  fromPrice: boolean;
  variantCount: number;
  imageUrl: string | null;
  productUrl: string | null;
  syncedAt: string | null;
};

const num = (v: string | null): number => (v === null ? Number.POSITIVE_INFINITY : Number(v));

function groupProducts(rows: VariantRow[], settings: Map<string, SettingRow>): SiteProduct[] {
  const byKey = new Map<string, VariantRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.product_key);
    if (list) list.push(row);
    else byKey.set(row.product_key, [row]);
  }

  const out: SiteProduct[] = [];
  for (const [key, variants] of byKey) {
    const sellable = variants.filter(
      (v) => v.on_sale === true && v.archived !== true && v.sale_price !== null && Number(v.sale_price) > 0,
    );
    const ordered = [...(sellable.length > 0 ? sellable : variants)].sort(
      (a, b) => num(a.sale_price) - num(b.sale_price) || a.external_id.localeCompare(b.external_id),
    );
    const lead = ordered[0]!;
    const prices = sellable.map((v) => Number(v.sale_price));
    const price = prices.length > 0 ? Math.min(...prices) : null;
    const leadList = lead.list_price === null ? null : Number(lead.list_price);
    const title = (lead.title ?? variants.find((v) => v.title)?.title ?? key).trim();
    const setting = settings.get(key);
    const autoCorner = guessCorner(title);
    const corner = setting?.corner ?? null;
    const displayName = setting?.display_name ?? null;
    const syncedAt = variants.reduce((max, v) => (v.synced_at > max ? v.synced_at : max), variants[0]!.synced_at);

    out.push({
      key,
      title,
      displayName,
      name: displayName ?? title,
      hidden: setting?.hidden ?? false,
      corner,
      autoCorner,
      effectiveCorner: corner ?? autoCorner,
      sellable: sellable.length > 0,
      inStock: sellable.some((v) => (v.quantity ?? 0) > 0),
      price,
      listPrice: price !== null && leadList !== null && leadList > price + 0.009 ? leadList : null,
      fromPrice: new Set(prices).size > 1,
      variantCount: sellable.length,
      imageUrl: [lead, ...ordered, ...variants].map((v) => safeUrl(v.image_url, IMAGE_HOST)).find(Boolean) ?? null,
      productUrl: ordered.map((v) => safeUrl(v.product_url, LISTING_HOST)).find(Boolean) ?? null,
      syncedAt: syncedAt.toISOString(),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

async function loadProducts(keys?: string[]): Promise<SiteProduct[]> {
  const filter = keys ? "AND COALESCE(product_main_id, external_id) = ANY($1::text[])" : "";
  const variants = await pool.query<VariantRow>(
    `SELECT COALESCE(product_main_id, external_id) AS product_key, external_id, title, quantity,
            list_price, sale_price, on_sale, archived, product_url, image_url, synced_at
       FROM channel_products
      WHERE channel = 'trendyol' ${filter}`,
    keys ? [keys] : [],
  );
  const settings = await pool.query<SettingRow>(
    `SELECT product_key, hidden, corner, display_name FROM site_products
      ${keys ? "WHERE product_key = ANY($1::text[])" : ""}`,
    keys ? [keys] : [],
  );
  return groupProducts(variants.rows, new Map(settings.rows.map((s) => [s.product_key, s])));
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/** Panelin "Site mağazası" ekranı: Trendyol'daki her ürün ve site ayarı. */
export async function listSiteProducts(): Promise<{ syncedAt: string | null; products: SiteProduct[] }> {
  const products = await loadProducts();
  const syncedAt = products.reduce<string | null>((max, p) => (p.syncedAt && (!max || p.syncedAt > max) ? p.syncedAt : max), null);
  return { syncedAt, products };
}

export type SiteProductPatch = {
  hidden?: unknown;
  corner?: unknown;
  displayName?: unknown;
};

/** Bir ürünün site ayarını değiştirir; verilmeyen alanlar olduğu gibi kalır. */
export async function updateSiteProduct(key: string, patch: SiteProductPatch, actorUserId: string | number): Promise<SiteProduct> {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new ValidationError("Geçersiz ürün.");
  }
  if ("hidden" in patch && typeof patch.hidden !== "boolean") {
    throw new ValidationError("Görünürlük açık ya da kapalı olmalı.");
  }
  if ("corner" in patch && patch.corner !== null && !SITE_CORNERS.includes(patch.corner as SiteCorner)) {
    throw new ValidationError("Geçersiz köşe.");
  }
  let displayName: string | null | undefined;
  if ("displayName" in patch) {
    if (patch.displayName !== null && typeof patch.displayName !== "string") {
      throw new ValidationError("Ad metin olmalı.");
    }
    const trimmed = typeof patch.displayName === "string" ? patch.displayName.trim().replace(/\s+/g, " ") : "";
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new ValidationError(`Ad en fazla ${MAX_NAME_LENGTH} karakter olabilir.`);
    }
    displayName = trimmed.length > 0 ? trimmed : null;
  }

  const [current] = await loadProducts([key]);
  if (!current) throw new SiteProductNotFoundError();

  await pool.query(
    `INSERT INTO site_products (product_key, hidden, corner, display_name, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (product_key) DO UPDATE SET
       hidden = EXCLUDED.hidden,
       corner = EXCLUDED.corner,
       display_name = EXCLUDED.display_name,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      key,
      "hidden" in patch ? patch.hidden : current.hidden,
      "corner" in patch ? patch.corner : current.corner,
      displayName !== undefined ? displayName : current.displayName,
      actorUserId,
    ],
  );

  const [updated] = await loadProducts([key]);
  return updated!;
}

// ─── Site ────────────────────────────────────────────────────────────────────

export type SiteFeedProduct = {
  /** Model kodunun kısa özeti: sabit kalır, kodun kendisini açık etmez. */
  id: string;
  name: string;
  corner: SiteCorner | null;
  price: number;
  listPrice: number | null;
  fromPrice: boolean;
  /** Birden fazla seçenek varsa sayısı. */
  options: number | null;
  inStock: boolean;
  image: string | null;
  url: string;
};

/** Sitenin build sırasında okuduğu liste: yalnız satışta, gizlenmemiş ürünler. */
export async function getSiteFeed(): Promise<{ syncedAt: string | null; products: SiteFeedProduct[] }> {
  const { syncedAt, products } = await listSiteProducts();
  return {
    syncedAt,
    products: products
      .filter((p) => !p.hidden && p.sellable && p.price !== null && p.productUrl !== null)
      .map((p) => ({
        id: createHash("sha256").update(p.key).digest("hex").slice(0, 12),
        name: p.name,
        corner: p.effectiveCorner,
        price: p.price!,
        listPrice: p.listPrice,
        fromPrice: p.fromPrice,
        options: p.variantCount > 1 ? p.variantCount : null,
        inStock: p.inStock,
        image: p.imageUrl,
        url: p.productUrl!,
      })),
  };
}
