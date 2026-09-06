-- Spec §11 "Not kategorileri" (2026-09-06): her üst seviye not en fazla
-- bir kategori taşır (`notes.category_id` nullable); yanıtlar kategori
-- taşımaz. Kategori silme notu silmez, ON DELETE SET NULL yalnız bağı
-- temizler.
--
-- 0278_note_categories.sql ilk uygulamada çoktan çoğa bir bağlantı
-- kurmuştu. Uygulanmış ortamlarda migration geçmişini değiştirmeden
-- sözleşmeyi ileri taşıyoruz. Bir nota birden fazla kategori bağlanmışsa
-- en düşük id'li (en eski) kategori deterministik olarak korunur.

BEGIN;

ALTER TABLE notes
  ADD COLUMN category_id bigint;

UPDATE notes n
   SET category_id = selected.category_id
  FROM (
    SELECT note_id, min(category_id) AS category_id
      FROM note_category_links
     GROUP BY note_id
  ) selected
 WHERE n.id = selected.note_id
   AND n.parent_note_id IS NULL;

ALTER TABLE notes
  ADD CONSTRAINT notes_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES note_categories(id) ON DELETE SET NULL,
  ADD CONSTRAINT notes_replies_cannot_have_category
    CHECK (parent_note_id IS NULL OR category_id IS NULL);

CREATE INDEX notes_category_id_idx
  ON notes (category_id)
  WHERE category_id IS NOT NULL;

DROP TABLE note_category_links;

COMMIT;
