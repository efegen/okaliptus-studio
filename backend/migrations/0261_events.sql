-- Etkinlik (event) takip modülü — tek seferlik stüdyo etkinlikleri (örn. kahvaltılı
-- bahçe yogası günü). Katılımcı borcu/ödemesi bilinçli olarak öğrencinin ana
-- borç defterinden (lessons + product_sales) AYRI tutulur: etkinlik parasının bir
-- kısmı stüdyonun geliri olmayabilir (örn. restorana ödenecek kahvaltı payı), bu
-- yüzden KPI/Hareketler hesaplarına hiç karışmaz. Öğrenci profili bu tabloları
-- ayrıca sorgulayıp kendi kartında gösterir.

CREATE TABLE events (
  id                bigserial PRIMARY KEY,
  name              text NOT NULL,
  starts_at         timestamptz NOT NULL,
  location          text,
  status            text NOT NULL DEFAULT 'upcoming'
                      CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled')),
  capacity_limit    integer CHECK (capacity_limit IS NULL OR capacity_limit > 0),
  transport_enabled boolean NOT NULL DEFAULT false,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE TRIGGER events_touch_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- Serbest/özelleştirilebilir ücret kalemleri (Ders ücreti, Kahvaltı, ekipman...).
-- amount = normal (rol override'sız) tutar; rol bazlı istisnalar (örn. davetliden
-- ücret alınmaz) servis katmanında event_participant_fees satırı oluşturulurken
-- uygulanır — bu tabloda tutulmaz.
CREATE TABLE event_fee_items (
  id         bigserial PRIMARY KEY,
  event_id   bigint NOT NULL REFERENCES events(id),
  label      text NOT NULL,
  amount     numeric(12, 2) NOT NULL CHECK (amount >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_fee_items_event_id_idx ON event_fee_items(event_id);

-- Ulaşım planı açıksa (events.transport_enabled) kullanılan araçlar. Şoför ya
-- kayıtlı bir öğrenci ya da dışarıdan biri (isim/telefon) olabilir.
CREATE TABLE event_vehicles (
  id               bigserial PRIMARY KEY,
  event_id         bigint NOT NULL REFERENCES events(id),
  vehicle_type     text NOT NULL CHECK (vehicle_type IN ('student_car', 'rental_service')),
  driver_student_id bigint REFERENCES students(id),
  driver_name      text,
  driver_phone     text,
  passenger_seats  integer NOT NULL CHECK (passenger_seats > 0),
  meeting_time     timestamptz,
  meeting_place    text,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (driver_student_id IS NOT NULL OR driver_name IS NOT NULL)
);

CREATE INDEX event_vehicles_event_id_idx ON event_vehicles(event_id);

-- Bir etkinliğe eklenmiş öğrenciler. Liste boş başlar; kişiler tek tek aranıp
-- eklenir (kayıtlı öğrenci ya da yeni oluşturulan — yeni oluşturulan da ana
-- öğrenci listesine kaydedilir, bu tarafta ekstra bir iz bırakmaz).
-- guest_of_participant_id: "birinin misafiri" bağlantısı, katılımcı listesinde
-- ağaç görünümü için kullanılır.
CREATE TABLE event_participants (
  id                      bigserial PRIMARY KEY,
  event_id                bigint NOT NULL REFERENCES events(id),
  student_id              bigint NOT NULL REFERENCES students(id),
  role                    text NOT NULL DEFAULT 'regular'
                            CHECK (role IN ('regular', 'invited', 'volunteer')),
  rsvp_status             text NOT NULL DEFAULT 'unsure'
                            CHECK (rsvp_status IN ('coming', 'unsure', 'not_coming')),
  guest_of_participant_id bigint REFERENCES event_participants(id),
  transport_mode          text NOT NULL DEFAULT 'unspecified'
                            CHECK (transport_mode IN ('needs_vehicle', 'self_arranged', 'unspecified')),
  vehicle_id              bigint REFERENCES event_vehicles(id),
  attendance_status       text NOT NULL DEFAULT 'pending'
                            CHECK (attendance_status IN ('pending', 'arrived', 'no_show')),
  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, student_id)
);

CREATE INDEX event_participants_event_id_idx ON event_participants(event_id);
CREATE INDEX event_participants_student_id_idx ON event_participants(student_id);

CREATE TRIGGER event_participants_touch_updated_at
  BEFORE UPDATE ON event_participants
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- Katılımcı × ücret kalemi. included=false = bu kalem bu kişi için geçerli değil
-- (istemiyor ya da parayı başka bir yolla — örn. restorana kendisi — ödeyecek);
-- sebebi sistemde ayrıca dallanmaz, gerekirse note'a yazılır. amount_snapshot,
-- oluşturulduğu andaki fee_item.amount'tan (rol override'ı uygulanmış olarak)
-- kopyalanır ve sonradan kalem fiyatı değişse bile sabit kalır.
CREATE TABLE event_participant_fees (
  id             bigserial PRIMARY KEY,
  participant_id bigint NOT NULL REFERENCES event_participants(id) ON DELETE CASCADE,
  fee_item_id    bigint NOT NULL REFERENCES event_fee_items(id),
  included       boolean NOT NULL DEFAULT true,
  amount_snapshot numeric(12, 2) NOT NULL CHECK (amount_snapshot >= 0),
  paid_amount    numeric(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, fee_item_id),
  CHECK (paid_amount <= amount_snapshot)
);

CREATE INDEX event_participant_fees_participant_id_idx ON event_participant_fees(participant_id);
