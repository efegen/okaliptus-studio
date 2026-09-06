-- Spec §11 "Not kategorileri" (2026-09-06): mobil Notlar ekranındaki
-- kullanıcı tanımlı kategoriler stüdyo genelinde ortak ve kalıcıdır. Bir not
-- sıfır, bir ya da birden fazla kategoriye bağlanabilir (çoklu seçim,
-- note_category_links); yalnız üst notlar kategori taşır, yanıtlar taşımaz
-- (uygulama katmanında zorlanır — bkz. notes.service.ts addNote/updateNote).
-- Kategori silme yok (ayarlar ekranında yalnız ekleme/yeniden adlandırma).

BEGIN;

CREATE TABLE note_categories (
  id                 bigserial PRIMARY KEY,
  name               text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  created_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX note_categories_name_unique_idx
  ON note_categories (lower(name));

CREATE TRIGGER note_categories_touch_updated_at
  BEFORE UPDATE ON note_categories
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE note_category_links (
  note_id     bigint NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES note_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, category_id)
);

CREATE INDEX note_category_links_category_idx
  ON note_category_links (category_id);

COMMIT;
