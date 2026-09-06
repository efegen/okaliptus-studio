-- Spec §11 "Misafirli katılımcı kaldırma seçenekleri" (2026-09-06): bir host
-- katılımcı listeden kaldırılırken misafiri varsa artık iki yol sunulur —
-- bağlantıyı koparıp misafirleri bağımsız katılımcı yapmak (bu migration'ın
-- eklediği yeni audit action'ı) ya da misafirleri host ile birlikte kaldırmak
-- (mevcut 'event_participant_removed' action'ı tekrar kullanılır, yeni bir
-- action gerekmez — bkz. removeParticipant/events.service.ts).

INSERT INTO audit_log_actions (action) VALUES ('event_participant_guest_unlinked');
