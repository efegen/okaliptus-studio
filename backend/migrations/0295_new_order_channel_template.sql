-- Yeni sipariş bildirimi: pazaryeri adı şablona taşınır ({channel}).
--
-- Bildirim modülü (0258, notification_settings 'new_order') yalnız Trendyol
-- siparişlerini bildiriyordu ve varsayılan metin "Trendyol'dan yeni sipariş…"
-- diye sabitti. Hepsiburada siparişleri de Siparişler ekranına (ve
-- channel_order_sightings'e) düştüğü için zamanlayıcı artık iki kanalı da
-- bildirir ve şablona {channel} değişkenini ("Trendyol" | "Hepsiburada") verir.
--
-- Yalnız metin HÂLÂ VARSAYILANSA güncellenir (düz ya da kıvrık kesme işaretli
-- hali); kullanıcının değiştirdiği metne dokunulmaz.
--
-- ADDITIVE: şema değişmez, yalnız varsayılan metin.

BEGIN;

UPDATE notification_settings
   SET config = jsonb_set(config, '{bodyTemplate}', to_jsonb('{channel}''dan yeni sipariş: {customer} — #{order}'::text))
 WHERE key = 'new_order'
   AND config->>'bodyTemplate' IN (
     'Trendyol''dan yeni sipariş: {customer} — #{order}',
     'Trendyol’dan yeni sipariş: {customer} — #{order}'
   );

COMMIT;
