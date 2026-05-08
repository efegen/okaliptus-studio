-- Spec ref: §5.2 — ders tamamlama akışından "ürün satışı yapıldı mı?" sorusu
-- kaldırıldı. Ürün satışları artık yalnız v2 modülünden (gerçek ürün seçimi ile)
-- yapılıyor. product_sales.lesson_id ile direkt bağlama deprecated; ders bloğu
-- üzerinde gösterim aynı gün + aynı öğrenci eşleşmesi ile display-side yapılır
-- (listLessonsInRange query'si lateral join kullanır).
--
-- Bu migration mevcut tüm legacy bağları siler. Kolon ve FK constraint
-- (0221'den) korunur — rollback kolaylığı için. Kolonun değer alması artık hiçbir
-- akışta beklenmiyor.

UPDATE product_sales
   SET lesson_id = NULL
 WHERE lesson_id IS NOT NULL;
