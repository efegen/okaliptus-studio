-- Audit: işlem yapan kullanıcıyı derslere ve ödemelere bağlar.
-- Nullable: migration öncesi kayıtlar ve bootstrap dönemi NULL kalır.

ALTER TABLE lessons
  ADD COLUMN actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD COLUMN actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL;
