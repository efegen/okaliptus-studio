-- user_activity_days'e (0288) süre ve ilk etkileşim: uygulamada geçirilen süre
-- ping aralıklarından TAHMİN edilir (yaklaşık). Yeni giriş ilk ping'i 30 sn,
-- aynı giriş içindeki ping'ler önceki etkileşimden geçen süre (en fazla 90 sn)
-- kadar ekler. Ekran görünmüyorsa ping gitmediği için arka plan süresi sayılmaz.

ALTER TABLE user_activity_days
  ADD COLUMN active_seconds  integer     NOT NULL DEFAULT 0,
  ADD COLUMN first_active_at timestamptz;

UPDATE user_activity_days SET first_active_at = last_active_at WHERE first_active_at IS NULL;

ALTER TABLE user_activity_days ALTER COLUMN first_active_at SET DEFAULT now();
ALTER TABLE user_activity_days ALTER COLUMN first_active_at SET NOT NULL;
