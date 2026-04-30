-- Studio settings'teki default_lesson_price de kalktı. Yeni modelde tek fiyat
-- kaynağı lesson_types.default_price. Settings ekranındaki "Varsayılan ders
-- ücreti" satırı da frontend'ten kaldırıldı (src/settings.jsx).

ALTER TABLE studio_settings DROP COLUMN default_lesson_price;
