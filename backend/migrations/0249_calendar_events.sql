-- Ref: Takvim plan/etkinlik desteği (v1.5+)
BEGIN;

CREATE TABLE calendar_events (
  id               bigserial PRIMARY KEY,
  event_type       text NOT NULL CHECK (event_type IN ('etkinlik','toplanti','diger')),
  title            text NOT NULL,
  starts_at        timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  all_day          boolean NOT NULL DEFAULT false,
  label_color      text NOT NULL DEFAULT 'graphite'
                   CHECK (label_color IN ('graphite','slate','plum','teal')),
  note             text,
  created_by       bigint REFERENCES users(id),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_events_range
  ON calendar_events (starts_at)
  WHERE deleted_at IS NULL;

COMMIT;
