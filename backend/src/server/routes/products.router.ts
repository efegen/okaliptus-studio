// v1.6 — products endpoints. Auth: requireAuth (mevcut single-admin modeli).

import express, { Router, type Request, type Response } from "express";

import {
  archiveProduct,
  bulkArchiveProducts,
  bulkSetCategory,
  bulkUnarchiveProducts,
  bulkUpdatePrice,
  createProduct,
  deleteProduct,
  deleteProductImage,
  getProductById,
  getProductImage,
  listCategories,
  listProducts,
  renameCategory,
  setProductImage,
  unarchiveProduct,
  updateProduct,
  type BulkPriceMode,
} from "../../services/products.service.js";
import { parseId, sendError } from "../middleware/response.js";

function parseIdsArray(raw: unknown): Array<string | number> {
  if (!Array.isArray(raw)) {
    throw Object.assign(new Error("ids dizisi gerekli."), {
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
  }
  return raw.filter(v => v !== null && v !== undefined && v !== "") as Array<string | number>;
}

export const productsRouter = Router();

// GET /products?search=&includeArchived=&category=
productsRouter.get("/", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const includeArchived = req.query.includeArchived === "true";
    const data = await listProducts({ search, includeArchived, category });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /products/categories — distinct kategoriler + ürün sayıları
// Filtre dropdown'ları için. Bu route /:id'den ÖNCE tanımlı olmalı,
// yoksa Express "categories" parametresini id sanır.
productsRouter.get("/categories", async (_req, res) => {
  try {
    const data = await listCategories();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products/categories/rename
// body: { from: string, to: string | null }   (to=null → kategori temizler)
productsRouter.post("/categories/rename", async (req, res) => {
  try {
    const { from, to } = req.body as Record<string, unknown>;
    if (typeof from !== "string" || from.trim() === "") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "from zorunlu." } });
      return;
    }
    const toValue = to === null || to === undefined || to === "" ? null : String(to);
    const data = await renameCategory(from, toValue, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products/bulk/archive   body: { ids: number[] }
productsRouter.post("/bulk/archive", async (req, res) => {
  try {
    const ids = parseIdsArray((req.body as Record<string, unknown>).ids);
    const data = await bulkArchiveProducts(ids, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products/bulk/unarchive   body: { ids: number[] }
productsRouter.post("/bulk/unarchive", async (req, res) => {
  try {
    const ids = parseIdsArray((req.body as Record<string, unknown>).ids);
    const data = await bulkUnarchiveProducts(ids, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products/bulk/price
// body: { ids: number[], mode: 'set'|'add'|'multiply', value: number }
//   set      → tüm seçili ürünlerin fiyatı = value
//   add      → her ürünün fiyatına value eklenir (negatif → çıkarır)
//   multiply → her ürün × (1 + value/100) (örn. value=10 → %10 zam)
productsRouter.post("/bulk/price", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const ids = parseIdsArray(body.ids);
    const mode = body.mode;
    if (mode !== "set" && mode !== "add" && mode !== "multiply") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "mode 'set' / 'add' / 'multiply' olmalı." } });
      return;
    }
    const value = Number(body.value);
    if (!Number.isFinite(value)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "value sayı olmalı." } });
      return;
    }
    const data = await bulkUpdatePrice(ids, mode as BulkPriceMode, value, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products/bulk/category   body: { ids: number[], category: string | null }
productsRouter.post("/bulk/category", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const ids = parseIdsArray(body.ids);
    const cat = body.category === null || body.category === undefined || body.category === ""
      ? null
      : String(body.category);
    const data = await bulkSetCategory(ids, cat, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /products/:id
productsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await getProductById(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// ── Görsel: kendi barındırma ───────────────────────────────────────────────
// image_url'a `…/products/:id/image?v=<ts>` yazıldığı için <img> bu route'a
// gelir. `v` her güncellemede değiştiğinden immutable cache güvenli; ETag ile
// 304 de desteklenir.

// GET /products/:id/image handler — app.ts'te requireAuth ÖNCESİNDE public
// register edilir. Gerekçe: image_url'ler zaten public (0229; Trendyol CDN gibi)
// ve cross-site <img> istekleri third-party cookie engeline takılmasın diye
// auth'suz servis edilir. POST/DELETE (yazma) authed kalır.
export async function serveProductImageHandler(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req.params.id);
    const image = await getProductImage(id);
    if (!image) {
      res.status(404).json({ error: { code: "PRODUCT_IMAGE_NOT_FOUND", message: "Ürün görseli yok." } });
      return;
    }
    const etag = `"${new Date(image.updatedAt).getTime()}"`;
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", image.mime);
    res.setHeader("Content-Length", image.bytes.length);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(image.bytes);
  } catch (err) {
    sendError(res, err);
  }
}

// POST /products/:id/image — ham görsel bytes (image/webp|jpeg|png). Bu route
// kendi raw parser'ını kullanır (5MB); global express.json() image/* için
// gövdeyi tüketmez. Frontend görseli ~800x800 WebP'e küçültüp yollar.
productsRouter.post(
  "/:id/image",
  express.raw({ type: ["image/webp", "image/jpeg", "image/png"], limit: "5mb" }),
  async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Görsel verisi okunamadı. İçerik tipi image/webp, image/jpeg veya image/png olmalı.",
          },
        });
        return;
      }
      const mime = (req.get("content-type") || "").split(";")[0].trim();
      const publicBaseUrl = `${req.protocol}://${req.get("host")}`;
      const data = await setProductImage(id, mime, req.body, publicBaseUrl, req.currentUser.id);
      res.json({ data });
    } catch (err) {
      sendError(res, err);
    }
  },
);

// DELETE /products/:id/image — görseli kaldırır, image_url bize aitse temizler.
productsRouter.delete("/:id/image", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await deleteProductImage(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products
productsRouter.post("/", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const data = await createProduct({
      name: String(body.name ?? ""),
      price: body.price as string | number,
      barcode: body.barcode != null ? String(body.barcode) : null,
      imageUrl: body.imageUrl != null ? String(body.imageUrl) : null,
      tyListingUrl: body.tyListingUrl != null ? String(body.tyListingUrl) : null,
      hbListingUrl: body.hbListingUrl != null ? String(body.hbListingUrl) : null,
      notes: body.notes != null ? String(body.notes) : null,
      parentProductCode: body.parentProductCode != null ? String(body.parentProductCode) : null,
      variantLabel: body.variantLabel != null ? String(body.variantLabel) : null,
      category: body.category != null ? String(body.category) : null,
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /products/:id
productsRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const patch: Parameters<typeof updateProduct>[1] = {};

    if (body.name !== undefined) patch.name = String(body.name);
    if (body.price !== undefined) patch.price = body.price as string | number;
    if (body.barcode !== undefined) patch.barcode = body.barcode === null ? null : String(body.barcode);
    if (body.imageUrl !== undefined) patch.imageUrl = body.imageUrl === null ? null : String(body.imageUrl);
    if (body.tyListingUrl !== undefined) patch.tyListingUrl = body.tyListingUrl === null ? null : String(body.tyListingUrl);
    if (body.hbListingUrl !== undefined) patch.hbListingUrl = body.hbListingUrl === null ? null : String(body.hbListingUrl);
    if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes);
    if (body.parentProductCode !== undefined) patch.parentProductCode = body.parentProductCode === null ? null : String(body.parentProductCode);
    if (body.variantLabel !== undefined) patch.variantLabel = body.variantLabel === null ? null : String(body.variantLabel);
    if (body.category !== undefined) patch.category = body.category === null ? null : String(body.category);

    const data = await updateProduct(id, patch, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products/:id/archive
productsRouter.post("/:id/archive", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await archiveProduct(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products/:id/unarchive
productsRouter.post("/:id/unarchive", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await unarchiveProduct(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /products/:id — kalıcı silme. Yalnız arşivlenmiş ürünler; aktif ürün
// 409 DELETE_CONFLICT döndürür (önce arşivle). /:id/image route'u tek segment
// fazlası olduğu için bu route'u gölgelemez.
productsRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await deleteProduct(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
