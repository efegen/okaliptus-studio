-- Ref: calendar_events (0249) event_type üç seçenekli (etkinlik/toplanti/diger)
-- olarak tasarlanmıştı ama mobil UI tek bir genel "plan" akışına indirgendi.
-- Eski migration in-place düzenlenmez; bu dosya kolonu tek değere daraltır.
BEGIN;

ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_event_type_check;

UPDATE calendar_events SET event_type = 'plan' WHERE event_type <> 'plan';

ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_event_type_check
  CHECK (event_type = 'plan');

COMMIT;
