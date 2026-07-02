-- Esquema de base de datos para Chinchón Online

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar        TEXT DEFAULT 'avatar-1',
  balance       INTEGER DEFAULT 0,
  is_admin      BOOLEAN DEFAULT false,
  games_played  INTEGER DEFAULT 0,
  games_won     INTEGER DEFAULT 0,
  games_lost    INTEGER DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(30) NOT NULL CHECK (type IN (
    'deposit', 'withdraw',
    'game-win', 'game-loss',
    'tournament-entry', 'tournament-refund', 'tournament-win', 'tournament-finalist',
    'holdem-buyin', 'holdem-cashout'
  )),
  amount     INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_ranking (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  points     INTEGER DEFAULT 0,
  earnings   INTEGER DEFAULT 0,
  week_start DATE NOT NULL,
  UNIQUE(user_id, week_start)
);

CREATE TABLE IF NOT EXISTS game_history (
  id          SERIAL PRIMARY KEY,
  table_id    VARCHAR(36) NOT NULL,
  winner_id   INTEGER REFERENCES users(id),
  players     JSONB,
  scores      JSONB,
  bet         INTEGER,
  played_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournaments (
  id                    UUID PRIMARY KEY,
  status                VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  starts_at             TIMESTAMPTZ NOT NULL,
  registration_deadline TIMESTAMPTZ NOT NULL,
  entry_fee             INTEGER NOT NULL DEFAULT 1000,
  min_players           INTEGER NOT NULL DEFAULT 8,
  total_players         INTEGER DEFAULT 0,
  prize_pool            INTEGER DEFAULT 0,
  winner_id             INTEGER REFERENCES users(id),
  finalist_id           INTEGER REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_registrations (
  tournament_id UUID    REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS holdem_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_in      INTEGER NOT NULL,
  blinds_small INTEGER NOT NULL,
  blinds_big   INTEGER NOT NULL,
  max_players  INTEGER NOT NULL DEFAULT 4,
  max_rebuys   INTEGER NOT NULL DEFAULT 3,
  status       VARCHAR(10) DEFAULT 'waiting',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holdem_hands (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id     UUID,
  winner_id    INTEGER REFERENCES users(id),
  pot          INTEGER NOT NULL,
  winning_hand VARCHAR(100),
  played_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL,
  sender_name    VARCHAR(255) NOT NULL,
  sender_bank    VARCHAR(100) NOT NULL,
  transaction_id VARCHAR(100) NOT NULL,
  mp_payment_id  VARCHAR(50) UNIQUE,
  approved       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_wallet_history_user ON wallet_history(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_ranking_week ON weekly_ranking(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_ranking_points ON weekly_ranking(points DESC);
CREATE INDEX IF NOT EXISTS idx_tournament_reg ON tournament_registrations(tournament_id);

-- Migración: ampliar constraint de wallet_history si ya existe la tabla
DO $$
BEGIN
  ALTER TABLE wallet_history DROP CONSTRAINT IF EXISTS wallet_history_type_check;
  ALTER TABLE wallet_history ADD CONSTRAINT wallet_history_type_check
    CHECK (type IN (
      'deposit', 'withdraw',
      'game-win', 'game-loss',
      'tournament-entry', 'tournament-refund', 'tournament-win', 'tournament-finalist',
      'holdem-buyin', 'holdem-cashout'
    ));
EXCEPTION WHEN others THEN NULL;
END$$;

-- Migración: agregar mp_payment_id a deposit_requests
DO $$
BEGIN
  ALTER TABLE deposit_requests ADD COLUMN mp_payment_id VARCHAR(50) UNIQUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END$$;

-- Migración: agregar columna is_admin
DO $$
BEGIN
  ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END$$;

-- Migración: cambiar avatar a TEXT para soportar base64
DO $$
BEGIN
  ALTER TABLE users ALTER COLUMN avatar TYPE TEXT;
EXCEPTION WHEN others THEN NULL;
END$$;

-- Migración: agregar columna banned
DO $$
BEGIN
  ALTER TABLE users ADD COLUMN banned BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END$$;

-- Migración: agregar columna rejected a deposit_requests
DO $$
BEGIN
  ALTER TABLE deposit_requests ADD COLUMN rejected BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END$$;

-- Tabla truco
CREATE TABLE IF NOT EXISTS truco_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status      VARCHAR(20) DEFAULT 'waiting',
  max_players INT NOT NULL CHECK (max_players IN (2,4)),
  buy_in      INT NOT NULL DEFAULT 0,
  point_limit INT NOT NULL DEFAULT 15,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Mensajes privados
CREATE TABLE IF NOT EXISTS private_messages (
  id           SERIAL PRIMARY KEY,
  sender_id    INT NOT NULL REFERENCES users(id),
  recipient_id INT NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id    INT REFERENCES private_messages(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pm_recipient ON private_messages(recipient_id, read);

-- Auditoría de acciones admin
CREATE TABLE IF NOT EXISTS admin_actions (
  id          SERIAL PRIMARY KEY,
  admin_id    INT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración: campo bio en usuarios
DO $$
BEGIN
  ALTER TABLE users ADD COLUMN bio VARCHAR(200) DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END$$;

-- Migración: tipos admin-adjustment y truco-buyin/cashout en wallet_history
DO $$
BEGIN
  ALTER TABLE wallet_history DROP CONSTRAINT IF EXISTS wallet_history_type_check;
  ALTER TABLE wallet_history ADD CONSTRAINT wallet_history_type_check
    CHECK (type IN (
      'deposit', 'withdraw',
      'game-win', 'game-loss',
      'tournament-entry', 'tournament-refund', 'tournament-win', 'tournament-finalist',
      'holdem-buyin', 'holdem-cashout',
      'truco-buyin', 'truco-cashout',
      'admin-adjustment'
    ));
EXCEPTION WHEN others THEN NULL;
END$$;
