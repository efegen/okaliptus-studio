ALTER TABLE studio_settings
  ADD COLUMN IF NOT EXISTS lesson_color_saturation FLOAT NOT NULL DEFAULT 1.0;
