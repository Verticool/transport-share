-- 001_init.sql — начальная схема сервиса шеринга самокатов.
--
-- Деньги — целые числа в минорных единицах (тыйыны), валюта — отдельная колонка: дробных денег
-- в базе нет, поэтому округление нигде не «накапливается». Все временные метки — timestamptz.
-- Идентификаторы — uuid: их генерирует приложение, поэтому ключи не зависят от схемы.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Пользователи ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email)) > 0),
  CONSTRAINT users_name_not_blank  CHECK (length(btrim(name)) > 0)
);

-- Email сравнивается без учёта регистра: «Demo@» и «demo@» — один аккаунт.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- ── Самокаты ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE scooters (
  id                  uuid PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  model               text NOT NULL,
  status              text NOT NULL,
  battery_pct         integer NOT NULL,
  lat                 double precision NOT NULL,
  lng                 double precision NOT NULL,
  low_battery_flagged boolean NOT NULL DEFAULT false,
  last_seen_at        timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scooters_status_known CHECK (status IN ('free', 'reserved', 'in_ride', 'unavailable')),
  CONSTRAINT scooters_battery_range CHECK (battery_pct BETWEEN 0 AND 100),
  CONSTRAINT scooters_lat_range CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT scooters_lng_range CHECK (lng BETWEEN -180 AND 180)
);

-- ── Брони ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE bookings (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scooter_id  uuid NOT NULL REFERENCES scooters (id) ON DELETE CASCADE,
  status      text NOT NULL,
  reserved_at timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  notified_at timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_status_known CHECK (status IN ('active', 'expired', 'cancelled', 'consumed')),
  CONSTRAINT bookings_expires_after_reserve CHECK (expires_at > reserved_at),
  CONSTRAINT bookings_closed_consistency CHECK (
    (status = 'active' AND closed_at IS NULL) OR (status <> 'active' AND closed_at IS NOT NULL)
  )
);

-- Требование B2: один самокат не может быть забронирован дважды.
-- Частичный уникальный индекс — это гарантия на уровне БД, а не проверка в коде: две
-- одновременные вставки не пройдут обе, даже если приложение ошиблось.
CREATE UNIQUE INDEX bookings_one_active_per_scooter ON bookings (scooter_id) WHERE status = 'active';
-- И одна активная бронь на пользователя — то же правило с другой стороны.
CREATE UNIQUE INDEX bookings_one_active_per_user ON bookings (user_id) WHERE status = 'active';
CREATE INDEX bookings_user_started_idx ON bookings (user_id, reserved_at DESC);

-- ── Поездки ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE rides (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scooter_id     uuid NOT NULL REFERENCES scooters (id) ON DELETE CASCADE,
  booking_id     uuid REFERENCES bookings (id) ON DELETE SET NULL,
  status         text NOT NULL,
  started_at     timestamptz NOT NULL,
  finished_at    timestamptz,
  end_reason     text,
  distance_m     integer NOT NULL DEFAULT 0,
  total_amount   bigint,
  currency       text NOT NULL DEFAULT 'KGS',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rides_status_known CHECK (status IN ('active', 'paused', 'finished')),
  CONSTRAINT rides_end_reason_known CHECK (
    end_reason IS NULL OR end_reason IN ('user', 'battery_depleted', 'service')
  ),
  CONSTRAINT rides_finished_consistency CHECK (
    (status = 'finished' AND finished_at IS NOT NULL AND end_reason IS NOT NULL AND total_amount IS NOT NULL)
    OR (status <> 'finished' AND finished_at IS NULL)
  ),
  CONSTRAINT rides_distance_non_negative CHECK (distance_m >= 0),
  CONSTRAINT rides_amount_non_negative CHECK (total_amount IS NULL OR total_amount >= 0)
);

-- Одна поездка на одну бронь и один незавершённый заезд на самокат.
CREATE UNIQUE INDEX rides_booking_key ON rides (booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX rides_one_open_per_scooter ON rides (scooter_id) WHERE status <> 'finished';
CREATE UNIQUE INDEX rides_one_open_per_user ON rides (user_id) WHERE status <> 'finished';
CREATE INDEX rides_user_started_idx ON rides (user_id, started_at DESC);

-- ── Паузы поездки ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ride_pauses (
  id         uuid PRIMARY KEY,
  ride_id    uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ride_pauses_ends_after_start CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- Открытая пауза у поездки может быть только одна: иначе время паузы посчиталось бы дважды.
CREATE UNIQUE INDEX ride_pauses_one_open_per_ride ON ride_pauses (ride_id) WHERE ended_at IS NULL;

-- ── Точки маршрута и события (append-only) ────────────────────────────────────────────────────
CREATE TABLE ride_points (
  id           bigserial PRIMARY KEY,
  ride_id      uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  battery_pct  integer NOT NULL,
  recorded_at  timestamptz NOT NULL,
  CONSTRAINT ride_points_battery_range CHECK (battery_pct BETWEEN 0 AND 100)
);

CREATE INDEX ride_points_ride_time_idx ON ride_points (ride_id, recorded_at);

CREATE TABLE ride_events (
  id          bigserial PRIMARY KEY,
  ride_id     uuid REFERENCES rides (id) ON DELETE CASCADE,
  scooter_id  uuid REFERENCES scooters (id) ON DELETE SET NULL,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL
);

CREATE INDEX ride_events_ride_time_idx ON ride_events (ride_id, recorded_at);
CREATE INDEX ride_events_type_time_idx ON ride_events (type, recorded_at DESC);

-- ── Счета (append-only) ───────────────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id         uuid PRIMARY KEY,
  ride_id    uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  breakdown  jsonb NOT NULL,
  amount     bigint NOT NULL,
  currency   text NOT NULL DEFAULT 'KGS',
  issued_at  timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_amount_non_negative CHECK (amount >= 0),
  -- Требование B8: на поездку ровно один счёт. Повторная финализация не создаст второй.
  CONSTRAINT invoices_ride_unique UNIQUE (ride_id)
);

CREATE INDEX invoices_user_issued_idx ON invoices (user_id, issued_at DESC);

-- ── Письма (эмуляция почты, append-only) ──────────────────────────────────────────────────────
CREATE TABLE emails (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  dedupe_key text NOT NULL,
  sent_at    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Ключ дедупликации: «по завершении поездки приходит одно письмо» — требование ТЗ.
  CONSTRAINT emails_dedupe_key_unique UNIQUE (dedupe_key)
);

CREATE INDEX emails_user_sent_idx ON emails (user_id, sent_at DESC);

-- ── Обновление updated_at ─────────────────────────────────────────────────────────────────────
-- Метку ставит база, а не приложение: тогда она верна и при ручных правках, и при миграциях.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER scooters_set_updated_at BEFORE UPDATE ON scooters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rides_set_updated_at BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ride_pauses_set_updated_at BEFORE UPDATE ON ride_pauses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
