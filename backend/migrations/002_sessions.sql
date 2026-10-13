-- 002_sessions.sql — сессии обновления.
--
-- Зачем таблица, если токен можно просто подписать: выход и смена пароля должны гасить доступ.
-- Подписанный токен без записи в базе отозвать нельзя — он остаётся действительным до истечения
-- срока. Держим хеш (а не сам токен): утечка дампа базы не даёт войти по чужой сессии.

CREATE TABLE sessions (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 от токена обновления: сам токен живёт только у клиента.
  token_hash    text NOT NULL UNIQUE,
  user_agent    text,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);
-- Действующая сессия: не истекла и не отозвана. Отдельный индекс нужен проверке токена.
CREATE INDEX sessions_active_idx ON sessions (token_hash) WHERE revoked_at IS NULL;

CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
