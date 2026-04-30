-- Ref: §3.1 studio_settings
-- Singleton tablo. CHECK (id = 1) + PK ile en fazla 1 satır garantisi.

CREATE TABLE studio_settings (
  id                  integer PRIMARY KEY CHECK (id = 1),
  weekly_capacity     integer NOT NULL DEFAULT 25 CHECK (weekly_capacity > 0),
  timezone            text    NOT NULL DEFAULT 'Europe/Istanbul',
  default_currency    text    NOT NULL DEFAULT 'TRY',
  week_start          text    NOT NULL DEFAULT 'monday' CHECK (week_start = 'monday'),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
