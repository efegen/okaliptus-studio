-- Ref: §3.9 DB-Level Invariant Trigger'ları
-- Tüm tablolar hazır olduktan sonra çalışır.

-- ─────────────────────────────────────────────────────────────────────────────
-- §3.9.1 Payment target coherence
-- lesson_id dolu ise: completed ve kredi ile karşılanmamış olmalı
-- product_sale_id / prepaid_package_id dolu ise: mevcut ve silinmemiş olmalı
-- Currency eşleşmesi kontrolü
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_validate_payment_target() RETURNS trigger AS $$
DECLARE
  v_lesson   lessons%ROWTYPE;
  v_sale     product_sales%ROWTYPE;
  v_package  prepaid_packages%ROWTYPE;
BEGIN
  IF NEW.lesson_id IS NOT NULL THEN
    SELECT * INTO v_lesson FROM lessons WHERE id = NEW.lesson_id;
    IF NOT FOUND OR v_lesson.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Payment target lesson not found or deleted';
    END IF;
    IF v_lesson.status <> 'completed' THEN
      RAISE EXCEPTION 'Payment allowed only on completed lesson (lesson #% status=%)', NEW.lesson_id, v_lesson.status;
    END IF;
    IF v_lesson.prepaid_package_id IS NOT NULL THEN
      RAISE EXCEPTION 'Credit-covered lesson has no debt; cannot attach payment (lesson #%)', NEW.lesson_id;
    END IF;
    IF v_lesson.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch: payment=% lesson=%', NEW.currency, v_lesson.currency;
    END IF;
  END IF;

  IF NEW.product_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM product_sales WHERE id = NEW.product_sale_id;
    IF NOT FOUND OR v_sale.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Payment target product_sale not found or deleted';
    END IF;
    IF v_sale.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch: payment=% product_sale=%', NEW.currency, v_sale.currency;
    END IF;
  END IF;

  IF NEW.prepaid_package_id IS NOT NULL THEN
    SELECT * INTO v_package FROM prepaid_packages WHERE id = NEW.prepaid_package_id;
    IF NOT FOUND OR v_package.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Payment target prepaid_package not found or deleted';
    END IF;
    IF v_package.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch: payment=% package=%', NEW.currency, v_package.currency;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_validate_target
  BEFORE INSERT OR UPDATE OF lesson_id, product_sale_id, prepaid_package_id, currency
  ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_validate_payment_target();

-- ─────────────────────────────────────────────────────────────────────────────
-- §3.9.2 Lesson credit coherence
-- prepaid_package_id set edilirken paketin aynı öğrenciye ait ve aktif olduğu doğrulanır.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_validate_lesson_credit() RETURNS trigger AS $$
DECLARE
  v_package prepaid_packages%ROWTYPE;
BEGIN
  IF NEW.prepaid_package_id IS NOT NULL
     AND (OLD.prepaid_package_id IS DISTINCT FROM NEW.prepaid_package_id) THEN
    SELECT * INTO v_package FROM prepaid_packages WHERE id = NEW.prepaid_package_id;
    IF NOT FOUND OR v_package.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Prepaid package not found or deleted';
    END IF;
    IF v_package.student_id <> NEW.student_id THEN
      RAISE EXCEPTION 'Package student mismatch: lesson student=% package student=%',
        NEW.student_id, v_package.student_id;
    END IF;
    IF v_package.currency <> NEW.currency THEN
      RAISE EXCEPTION 'Currency mismatch on credit allocation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lessons_validate_credit
  BEFORE UPDATE OF prepaid_package_id ON lessons
  FOR EACH ROW EXECUTE FUNCTION trg_validate_lesson_credit();

-- ─────────────────────────────────────────────────────────────────────────────
-- §3.9.3 Package payment non-deletion
-- Paket'e bağlı payment tek başına soft-delete edilemez.
-- Paket de aynı transaction'da siliniyorsa izin verilir.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_block_package_payment_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND NEW.prepaid_package_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM prepaid_packages
      WHERE id = NEW.prepaid_package_id
        AND deleted_at IS NOT NULL
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot soft-delete payment bound to active prepaid_package (payment #%, package #%)',
      NEW.id, NEW.prepaid_package_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_block_package_payment_delete
  BEFORE UPDATE OF deleted_at ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_block_package_payment_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- §3.9.4 updated_at auto-touch
-- updated_at kolonu olan her tabloda UPDATE sonrası otomatik güncellenir.
-- Servis katmanı manuel set etmez; trigger yönetir.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER students_touch_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TRIGGER lessons_touch_updated_at
  BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TRIGGER product_sales_touch_updated_at
  BEFORE UPDATE ON product_sales
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TRIGGER prepaid_packages_touch_updated_at
  BEFORE UPDATE ON prepaid_packages
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TRIGGER payments_touch_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- student_balance_transactions: updated_at yok (append-only ledger)
-- audit_logs: updated_at yok (append-only)
-- studio_settings: updated_at manuel set edilir (singleton)
