-- v1.6 — Model C / Faz 1: Trendyol iade (claims) → inceleme kuyruğu bağı.
--
-- Sorun: iadeler orders ucundan 'Returned' statüsüyle GÜVENİLİR gelmiyor (sipariş
-- teslim göründüğü hâlde müşteri iade açabiliyor); gerçek iade verisi ayrı bir uçtan,
-- /claims'ten akıyor. Bu yüzden "iade bekleyenler" kuyruğu boş kalıyordu.
--
-- Çözüm (PUSH YOK, read-only): claims periyodik çekilir; bir iade, ilgili SAYILMIŞ
-- sipariş satırını (channel_order_lines.state='counted') 'return_pending'e taşır.
-- Stok OTOMATİK geri eklenMEZ (Model C) — operatör malı sağlamsa elle setStock'la
-- ekler. Yeni tablo/STATE gerekmez: return_pending zaten 0244'te var, kuyruk zaten
-- onu gösterir. Bu migration yalnız iade kalemini operatöre düzgün göstermek için
-- claim ÜST VERİSİNİ (idempotensi + görüntüleme) channel_order_lines'a ekler.
--
-- İdempotensi: claim, satırı yalnız 'counted' iken 'return_pending'e taşır; tekrar
-- görmek no-op (zaten return_pending). resolved_at'e ASLA dokunulmaz (operatörün
-- "çözüldü" kararı korunur). Eşleşen sayılmış satır yoksa claim atlanır (stok etkisi
-- olmayan iade — yeni satır UYDURULMAZ).
--
-- ADDITIVE: yalnız nullable kolon ekleme. Mevcut veri/şema kırılmaz.

BEGIN;

-- channel_order_lines'a iade (claim) üst verisi. Hepsi nullable; yalnız bir iade
-- bu satıra bağlanınca dolar. claim_id idempotensi/izlenebilirlik, diğerleri kuyruk
-- görüntüsü (operatör neyin iade edildiğini ve nedenini görür).
ALTER TABLE channel_order_lines
  ADD COLUMN IF NOT EXISTS claim_id        text,         -- Trendyol claimId (UUID)
  ADD COLUMN IF NOT EXISTS claim_status    text,         -- claimItemStatus.name (Accepted/Cancelled/…)
  ADD COLUMN IF NOT EXISTS claim_reason    text,         -- trendyolClaimItemReason.name|code
  ADD COLUMN IF NOT EXISTS claim_quantity  integer,      -- iade edilen birim adedi (claimItems sayısı)
  ADD COLUMN IF NOT EXISTS claim_date      timestamptz,  -- iadenin açıldığı tarih (claimDate)
  ADD COLUMN IF NOT EXISTS claim_raw       jsonb;        -- ham claim satırı (hata ayıklama)

COMMIT;
