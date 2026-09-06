-- Etkinlik tahsilat defteri — etkinlik günü borç üretme akışından bağımsızdır.
-- Ref: yoga-studio-dashboard-v1-spec.md §4.1–§4.2; etkinlik ürün kararı.
--
-- event_participant_fees.paid_amount hızlı bakiye/snapshot alanı olarak kalır;
-- bu defter her tahsilatın kaynağını, kalem dağılımını ve iade sonrası iptalini
-- kaybetmeden saklar. Eski sayaç verisi de tek seferlik kayda dönüştürülür.

CREATE TABLE event_payments (
  id                    bigserial PRIMARY KEY,
  event_id              bigint NOT NULL REFERENCES events(id),
  participant_id        bigint REFERENCES event_participants(id) ON DELETE SET NULL,
  student_id            bigint NOT NULL REFERENCES students(id),
  amount                numeric(12, 2) NOT NULL CHECK (amount > 0),
  source                text NOT NULL CHECK (source IN ('cash', 'iban')),
  idempotency_key       text NOT NULL UNIQUE,
  paid_at               timestamptz NOT NULL DEFAULT now(),
  cancelled_at          timestamptz,
  cancellation_note     text,
  created_by_user_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (cancelled_at IS NOT NULL OR cancelled_by_user_id IS NULL)
);

CREATE INDEX event_payments_event_paid_at_idx ON event_payments(event_id, paid_at);
CREATE INDEX event_payments_participant_idx ON event_payments(participant_id);
CREATE INDEX event_payments_student_idx ON event_payments(student_id);
CREATE INDEX event_payments_active_paid_at_idx ON event_payments(paid_at)
  WHERE cancelled_at IS NULL;

CREATE TABLE event_payment_allocations (
  id                    bigserial PRIMARY KEY,
  payment_id            bigint NOT NULL REFERENCES event_payments(id),
  participant_fee_id    bigint REFERENCES event_participant_fees(id) ON DELETE SET NULL,
  fee_item_id           bigint NOT NULL REFERENCES event_fee_items(id),
  label_snapshot        text NOT NULL,
  is_pass_through       boolean NOT NULL,
  is_lesson_fee         boolean NOT NULL,
  amount                numeric(12, 2) NOT NULL CHECK (amount > 0),
  UNIQUE (payment_id, fee_item_id)
);

CREATE INDEX event_payment_allocations_payment_idx ON event_payment_allocations(payment_id);
CREATE INDEX event_payment_allocations_fee_idx ON event_payment_allocations(participant_fee_id);

CREATE FUNCTION trg_event_payment_verify_allocation_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_payment_id bigint := COALESCE(NEW.payment_id, OLD.payment_id);
  payment_amount numeric(12, 2);
  allocated_amount numeric(12, 2);
BEGIN
  SELECT amount INTO payment_amount FROM event_payments WHERE id = target_payment_id;
  IF payment_amount IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO allocated_amount
    FROM event_payment_allocations WHERE payment_id = target_payment_id;
  IF allocated_amount <> payment_amount THEN
    RAISE EXCEPTION 'Etkinlik tahsilatı dağılım toplamıyla eşleşmiyor.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER event_payment_allocation_total_check
  AFTER INSERT OR UPDATE OR DELETE ON event_payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_event_payment_verify_allocation_total();

-- Misafir ilişkisini DB seviyesinde de tek katmanla sınırla. Servis aynı kuralı
-- kullanıcı dostu hatayla uygular; trigger doğrudan SQL veya gelecekteki başka
-- bir istemcinin zincir oluşturmasını engelleyen son savunmadır.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM event_participants child
      JOIN event_participants parent ON parent.id = child.guest_of_participant_id
     WHERE parent.guest_of_participant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'İç içe misafir verisi var; 0276 öncesinde düzeltilmelidir.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION trg_event_participant_validate_guest_depth()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_event_id bigint;
  parent_guest_of_id bigint;
BEGIN
  IF NEW.guest_of_participant_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.guest_of_participant_id = NEW.id THEN
    RAISE EXCEPTION 'Katılımcı kendisinin misafiri olamaz.' USING ERRCODE = '23514';
  END IF;

  SELECT event_id, guest_of_participant_id
    INTO parent_event_id, parent_guest_of_id
    FROM event_participants
   WHERE id = NEW.guest_of_participant_id
   FOR SHARE;
  IF parent_event_id IS NULL OR parent_event_id <> NEW.event_id THEN
    RAISE EXCEPTION 'Misafir yalnızca aynı etkinlikteki bir katılımcıya bağlanabilir.'
      USING ERRCODE = '23514';
  END IF;
  IF parent_guest_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'Bir misafire başka bir misafir bağlanamaz.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM event_participants
     WHERE guest_of_participant_id = NEW.id AND id <> NEW.id
     FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Misafiri olan bir katılımcı başka birinin misafiri yapılamaz.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_participants_validate_guest_depth
  BEFORE INSERT OR UPDATE OF event_id, guest_of_participant_id ON event_participants
  FOR EACH ROW EXECUTE FUNCTION trg_event_participant_validate_guest_depth();

-- Henüz ledger yokken yazılmış geliştirme/erken dağıtım verisini koru.
INSERT INTO event_payments (
  event_id, participant_id, student_id, amount, source, idempotency_key, paid_at
)
SELECT p.event_id, p.id, p.student_id, SUM(f.paid_amount), 'cash',
       'legacy-event-participant-' || p.id::text,
       MAX(f.created_at)
  FROM event_participants p
  JOIN event_participant_fees f ON f.participant_id = p.id
 WHERE f.paid_amount > 0
 GROUP BY p.event_id, p.id, p.student_id;

INSERT INTO event_payment_allocations (
  payment_id, participant_fee_id, fee_item_id, label_snapshot,
  is_pass_through, is_lesson_fee, amount
)
SELECT ep.id, f.id, f.fee_item_id, i.label, i.is_pass_through,
       i.is_lesson_fee, f.paid_amount
  FROM event_participant_fees f
  JOIN event_participants p ON p.id = f.participant_id
  JOIN event_fee_items i ON i.id = f.fee_item_id
  JOIN event_payments ep
    ON ep.idempotency_key = 'legacy-event-participant-' || p.id::text
 WHERE f.paid_amount > 0;

-- Audit action/entity genişletmeleri önceki migration'larda CHECK'i her seferinde
-- yeniden kuruyordu. Büyük tabloda tekrar tarama ve kilit riskini burada bitir:
-- izinli değerler küçük sözlük tablolarında dursun; yeni değer eklemek bundan
-- sonra yalnızca bu tablolara INSERT gerektirsin.
CREATE TABLE audit_log_actions (action text PRIMARY KEY);
INSERT INTO audit_log_actions (action) VALUES
  ('lesson_created'), ('lesson_status_change'), ('lesson_uncompleted'), ('lesson_updated'),
  ('lesson_deleted'), ('lesson_discount_updated'), ('bulk_price_update'),
  ('payment_created'), ('payment_updated'), ('payment_deleted'),
  ('product_sale_created'), ('product_sale_updated'), ('product_sale_deleted'),
  ('prepaid_package_created'), ('prepaid_package_deleted'),
  ('student_created'), ('student_updated'), ('student_deleted'),
  ('lesson_type_created'), ('lesson_type_updated'), ('lesson_type_student_price_set'),
  ('lesson_type_student_price_removed'), ('instructor_created'), ('instructor_updated'),
  ('instructor_deleted'), ('product_created'), ('product_updated'), ('product_archived'),
  ('product_unarchived'), ('product_deleted'), ('settings_updated'), ('user_login'),
  ('user_logout'), ('user_created'), ('user_updated'), ('user_role_changed'),
  ('user_password_reset'), ('user_deactivated'), ('user_reactivated'), ('stock_adjusted'),
  ('channel_listing_changed'), ('calendar_event_created'), ('calendar_event_updated'),
  ('calendar_event_deleted'), ('event_created'), ('event_updated'), ('event_deleted'),
  ('note_created'), ('note_updated'), ('note_deleted'), ('event_note_created'),
  ('event_note_updated'), ('event_note_deleted'), ('event_fee_item_created'),
  ('event_participant_added'), ('event_participant_updated'), ('event_participant_removed'),
  ('event_participant_fee_updated'), ('event_participant_payment_recorded'),
  ('event_participant_payment_cancelled'), ('event_vehicle_created'),
  ('event_vehicle_updated'), ('event_vehicle_deleted'),
  ('event_participant_vehicle_assigned'), ('product_sale_cancelled'),
  ('product_sale_cancellation_voided'), ('product_sale_refund_created'),
  ('product_sale_refund_voided');

CREATE TABLE audit_log_entity_types (entity_type text PRIMARY KEY);
INSERT INTO audit_log_entity_types (entity_type) VALUES
  ('student'), ('lesson'), ('product_sale'), ('prepaid_package'), ('payment'),
  ('balance_transaction'), ('lesson_type'), ('lesson_type_student_price'),
  ('instructor'), ('product'), ('settings'), ('user'), ('calendar_event'), ('event'),
  ('note'), ('event_note'), ('event_fee_item'), ('event_participant'),
  ('event_participant_fee'), ('event_payment'), ('event_vehicle'),
  ('product_sale_cancellation'), ('product_sale_refund');

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_fkey
  FOREIGN KEY (action) REFERENCES audit_log_actions(action) NOT VALID;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_fkey
  FOREIGN KEY (entity_type) REFERENCES audit_log_entity_types(entity_type) NOT VALID;
ALTER TABLE audit_logs VALIDATE CONSTRAINT audit_logs_action_fkey;
ALTER TABLE audit_logs VALIDATE CONSTRAINT audit_logs_entity_type_fkey;
