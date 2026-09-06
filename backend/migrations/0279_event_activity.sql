-- Spec §11 "Etkinlik hareketleri" (2026-09-06): mobil etkinlik detayındaki
-- "Hareketler" kısayolu, o etkinlikte yapılan işlemleri kim-ne-zaman yaptı
-- bilgisiyle listeler ve hatalı bir işlemin geri alınmasını sağlar.
--
-- Neden audit_logs'a event_id: hareket akışı etkinliğe göre filtrelenmeli, ama
-- entity → etkinlik bağı her zaman join'lenemiyor. event_participants satırı
-- kaldırıldığında fiziksel olarak siliniyor (bkz. removeParticipant), dolayısıyla
-- "katılımcı kaldırıldı" kaydı join ile hiçbir etkinliğe bağlanamıyor. Bağ,
-- kaydın kendisinde saklanır. Etkinlik soft-delete olduğu için FK pratikte hiç
-- tetiklenmez; yine de SET NULL seçildi — denetim kaydı asla silinmesin, yalnız
-- etkinlik akışından düşsün.
--
-- reverted_at/reverted_by_user_id: geri alma, kaydı SİLMEZ. Telafi işlemi
-- (katılımcıyı geri ekle, tahsilatı iptal et, eski değere dön) kendi audit
-- kaydını yazar; orijinal satır yalnız "geri alındı" olarak işaretlenir. Böylece
-- hem hata hem düzeltmesi geçmişte görünür kalır ve aynı kayıt iki kez geri
-- alınamaz.

BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN event_id            bigint REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN reverted_at         timestamptz,
  ADD COLUMN reverted_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL;

-- Aktör silinirse isim düşer ama "geri alındı" damgası kalmalı; ters yönde
-- (damgasız aktör) anlamsız bir satır olurdu.
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_reverted_pair_check
  CHECK (reverted_at IS NOT NULL OR reverted_by_user_id IS NULL);

CREATE INDEX audit_logs_event_idx
  ON audit_logs (event_id, created_at DESC, id DESC)
  WHERE event_id IS NOT NULL;

-- Telafi işlemlerinin doğal karşılığı olmayan iki hareket (bkz. 0276'daki
-- sözlük tablosu — yeni değer artık CHECK yeniden kurmak yerine INSERT).
INSERT INTO audit_log_actions (action) VALUES
  ('event_participant_contact_reverted'),
  ('event_participant_vehicle_unassigned');

-- Bu migration'dan önce yazılmış etkinlik kayıtları da akışta görünsün.
-- Sıra önemli: önce doğrudan/join ile kesin bağ, sonra JSON içindeki artık
-- silinmiş satırların etkinlik kimliği.
UPDATE audit_logs a
   SET event_id = src.resolved_event_id
  FROM (
    SELECT l.id,
           COALESCE(
             CASE WHEN l.entity_type = 'event' THEN l.entity_id END,
             (SELECT p.event_id FROM event_participants p
               WHERE l.entity_type IN ('event_participant', 'event_participant_fee')
                 AND p.id = l.entity_id),
             (SELECT ep.event_id FROM event_payments ep
               WHERE l.entity_type = 'event_payment' AND ep.id = l.entity_id),
             (SELECT v.event_id FROM event_vehicles v
               WHERE l.entity_type = 'event_vehicle' AND v.id = l.entity_id),
             (SELECT i.event_id FROM event_fee_items i
               WHERE l.entity_type = 'event_fee_item' AND i.id = l.entity_id),
             CASE WHEN l.after ->> 'eventId' ~ '^\d+$' THEN (l.after ->> 'eventId')::bigint END,
             CASE WHEN l.before ->> 'event_id' ~ '^\d+$' THEN (l.before ->> 'event_id')::bigint END
           ) AS resolved_event_id
      FROM audit_logs l
     WHERE l.entity_type IN (
             'event', 'event_participant', 'event_participant_fee',
             'event_payment', 'event_vehicle', 'event_fee_item'
           )
  ) src
 WHERE a.id = src.id
   AND src.resolved_event_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM events e WHERE e.id = src.resolved_event_id);

COMMIT;
