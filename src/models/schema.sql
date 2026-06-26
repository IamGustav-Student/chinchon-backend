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
  type       VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdraw', 'game-win', 'game-loss')),
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

-- Índices
CREATE INDEX IF NOT EXISTS idx_wallet_history_user ON wallet_history(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_ranking_week ON weekly_ranking(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_ranking_points ON weekly_ranking(points DESC);
