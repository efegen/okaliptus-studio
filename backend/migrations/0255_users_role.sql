-- Ref: spec §2.14 (Auth) — RBAC Faz 1. users tablosuna sabit rol kolonu.
-- Dört rol: owner (Geliştirici), admin (Yönetici), instructor
-- (Yönetici-Eğitmen), assistant (Asistan). Mevcut kullanıcılar DEFAULT ile
-- 'admin' olur; owner terfisi bootstrap (BOOTSTRAP_OWNER_USERNAME) üzerinden
-- yapılır — migration env okumaz.
ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'admin'
  CONSTRAINT users_role_check CHECK (role IN ('owner', 'admin', 'instructor', 'assistant'));
