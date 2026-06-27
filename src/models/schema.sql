-- Esquema de base de datos para Chinchón Online

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar        VARCHAR(100) DEFAULT 'avatar-1',
  balance       INTEGER DEFAULT 10000,
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
    'tournament-entry', 'tournament-refund', 'tournament-win', 'tournament-finalist'
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
      'tournament-entry', 'tournament-refund', 'tournament-win', 'tournament-finalist'
    ));
EXCEPTION WHEN others THEN NULL;
END$$;
