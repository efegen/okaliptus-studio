-- Spec §11 "Etkinlik katılımcı iletişim aksiyonları" (2026-09-06):
-- katılımcı aramaları ve listeden kaldırma gerekçeleri, katılımcı
-- satırı sonradan silinse bile etkinlik operasyon geçmişinde kalır.

CREATE TABLE event_participant_interactions (
  id                 bigserial PRIMARY KEY,
  event_id           bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id     bigint NOT NULL,
  student_id         bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  interaction_type   text NOT NULL
                       CHECK (interaction_type IN ('called', 'removed')),
  removal_reason     text
                       CHECK (removal_reason IS NULL OR removal_reason IN (
                         'student_cancelled', 'plans_changed', 'added_by_mistake', 'other'
                       )),
  note               text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (interaction_type = 'called' AND removal_reason IS NULL)
    OR interaction_type = 'removed'
  )
);

CREATE INDEX event_participant_interactions_participant_idx
  ON event_participant_interactions (participant_id, occurred_at DESC, id DESC);

CREATE INDEX event_participant_interactions_event_idx
  ON event_participant_interactions (event_id, occurred_at DESC, id DESC);

INSERT INTO audit_log_actions (action)
VALUES ('event_participant_contacted');
