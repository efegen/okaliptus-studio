-- audit_logs tablosuna actor_user_id eklenir. Hangi adminin hangi işlemi
-- yaptığını izlemek için. Nullable: migration öncesi kayıtlar NULL kalır.

ALTER TABLE audit_logs
  ADD COLUMN actor_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_user_id, created_at DESC);
