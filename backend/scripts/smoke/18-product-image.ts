/**
 * SMOKE 18 — Product Image upload/serve/delete (v1.6)
 *
 * Senaryo:
 *   1. Ürün oluştur.
 *   2. setProductImage → image_url `…/products/:id/image?v=<ts>` olur.
 *   3. getProductImage → bytes/mime/byteSize doğru döner.
 *   4. Tekrar setProductImage (değiştir) → versiyon (?v=) ilerler.
 *   5. Geçersiz mime → VALIDATION_ERROR.
 *   6. Boş bytes → VALIDATION_ERROR.
 *   7. deleteProductImage → bytes gider (getProductImage null), image_url temizlenir.
 *   8. Harici (TY CDN) URL'li üründe deleteProductImage URL'i SİLMEZ.
 *
 * CLEANUP: test ürünleri hard-delete (product_images ON DELETE CASCADE ile gider).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/18-product-image.ts
 */

import {
  createProduct,
  setProductImage,
  getProductImage,
  deleteProductImage,
} from "../../src/services/products.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, getActorUserId, assertAuditLog, closePool, ok,
} from "./_shared.js";

const BASE = "http://localhost:4000";

async function run(): Promise<void> {
  const productIds: string[] = [];

  try {
    section("SMOKE 18 — Product Image upload/serve/delete");

    const actorUserId = await getActorUserId();

    // ── 1. Ürün oluştur ────────────────────────────────────────────────────
    step("Ürün oluşturuluyor...");
    const product = await createProduct({
      name: "SMOKE18_Tütsülük",
      price: "75.00",
      actorUserId,
    });
    productIds.push(product.id);
    info("product.id", product.id);
    assert(product.image_url === null, "başlangıçta image_url null");

    // ── 2. Görsel yükle ──────────────────────────────────────────────────────
    step("setProductImage (image/webp)...");
    const bytes = Buffer.from("SMOKE18-fake-webp-bytes-0123456789", "utf8");
    const withImg = await setProductImage(product.id, "image/webp", bytes, BASE, actorUserId);
    info("image_url", withImg.image_url);
    assert(
      !!withImg.image_url && withImg.image_url.includes(`/products/${product.id}/image?v=`),
      "image_url servis endpoint'ine + versiyona işaret ediyor",
    );
    await assertAuditLog({
      action: "product_updated",
      entityType: "product",
      entityId: product.id,
    });

    // ── 3. Görsel oku ──────────────────────────────────────────────────────
    step("getProductImage ile bytes okunuyor...");
    const img = await getProductImage(product.id);
    assert(!!img, "görsel kaydı var");
    if (img) {
      assertEqual(img.mime, "image/webp", "mime");
      assertEqual(img.byteSize, bytes.length, "byteSize");
      assert(Buffer.compare(img.bytes, bytes) === 0, "bytes birebir aynı");
    }

    // ── 4. Değiştir → versiyon ilerlemeli ─────────────────────────────────────
    step("Görsel değiştiriliyor, ?v= ilerlemeli...");
    const v1 = new URL(withImg.image_url as string).searchParams.get("v");
    await new Promise(r => setTimeout(r, 5)); // updated_at farkı için minik bekleme
    const bytes2 = Buffer.from("SMOKE18-second-image-payload", "utf8");
    const withImg2 = await setProductImage(product.id, "image/jpeg", bytes2, BASE, actorUserId);
    const v2 = new URL(withImg2.image_url as string).searchParams.get("v");
    assert(!!v1 && !!v2 && v1 !== v2, `versiyon ilerledi (${v1} → ${v2})`);
    const img2 = await getProductImage(product.id);
    assertEqual(img2?.mime ?? "", "image/jpeg", "yeni mime image/jpeg");

    // ── 5. Geçersiz mime ─────────────────────────────────────────────────────
    step("Geçersiz mime reddedilmeli...");
    await assertRejects(
      () => setProductImage(product.id, "image/gif", bytes, BASE, actorUserId),
      "VALIDATION_ERROR",
      "image/gif kabul edilmemeli",
    );

    // ── 6. Boş bytes ─────────────────────────────────────────────────────────
    step("Boş bytes reddedilmeli...");
    await assertRejects(
      () => setProductImage(product.id, "image/webp", Buffer.alloc(0), BASE, actorUserId),
      "VALIDATION_ERROR",
      "boş görsel kabul edilmemeli",
    );

    // ── 7. Görsel sil ─────────────────────────────────────────────────────────
    step("deleteProductImage → bytes gider, image_url temizlenir...");
    const cleared = await deleteProductImage(product.id, actorUserId);
    assert(cleared.image_url === null, "image_url temizlendi (bizim endpoint'imizdi)");
    const gone = await getProductImage(product.id);
    assert(gone === null, "getProductImage artık null");

    // ── 8. Harici URL'li üründe delete URL'i silmez ──────────────────────────
    step("Harici (TY CDN) URL'li üründe deleteProductImage URL'i korumalı...");
    const tyProduct = await createProduct({
      name: "SMOKE18_TY_Ürün",
      price: "99.00",
      imageUrl: "https://cdn.dsmcdn.com/example/x.jpg",
      actorUserId,
    });
    productIds.push(tyProduct.id);
    const afterDel = await deleteProductImage(tyProduct.id, actorUserId);
    assertEqual(
      afterDel.image_url,
      "https://cdn.dsmcdn.com/example/x.jpg",
      "harici image_url korunuyor (bizim endpoint'imiz değil)",
    );

    ok("\nSMOKE 18 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    if (productIds.length > 0) {
      // product_images ON DELETE CASCADE ile gider.
      await pool.query(
        `DELETE FROM products WHERE id = ANY($1::bigint[])`,
        [productIds],
      );
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
