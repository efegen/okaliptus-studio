-- Ref: post-incident düzeltme (0259) — "yeni sipariş" bildirimi first_seen_at'e
-- (bizim defterimizin siparişi İLK GÖRDÜĞÜ an) göre tetikleniyordu. Bu, tablo
-- boşken/yeni bir tarih aralığı ilk kez çekildiğinde TÜM geçmiş siparişlerin
-- birden "yeni" sayılıp tek seferde bildirilmesine yol açtı (canlı olayda 55
-- eski sipariş 3 gerçek kullanıcıya bildirilmeye çalışıldı).
--
-- order_date = Trendyol'un gerçek sipariş tarihi (DisplayOrder.orderDate).
-- Bildirim artık BUNA göre filtrelenir — ne zaman keşfedildiğimize değil,
-- siparişin GERÇEKTEN ne zaman verildiğine bakar. Böylece geniş/eski bir
-- pencere sonradan çekilse bile eski siparişler asla "yeni" sayılmaz.
ALTER TABLE channel_order_sightings
  ADD COLUMN order_date timestamptz;
