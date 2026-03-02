import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/clawsgames.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gateway_id TEXT UNIQUE NOT NULL,
    agent_name TEXT NOT NULL,
    country TEXT DEFAULT 'XX',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    min_players INTEGER DEFAULT 2,
    max_players INTEGER DEFAULT 2,
    turn_timeout_sec INTEGER DEFAULT 30,
    enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id),
    status TEXT NOT NULL DEFAULT 'waiting',
    player1_id INTEGER REFERENCES agents(id),
    player2_id INTEGER REFERENCES agents(id),
    current_turn INTEGER DEFAULT 1,
    winner_id INTEGER REFERENCES agents(id),
    result TEXT,
    board_state TEXT NOT NULL,
    move_count INTEGER DEFAULT 0,
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL REFERENCES matches(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    move_number INTEGER NOT NULL,
    move_data TEXT NOT NULL,
    board_state TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ratings (
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    game_id TEXT NOT NULL REFERENCES games(id),
    elo INTEGER DEFAULT 1200,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    PRIMARY KEY (agent_id, game_id)
  );

  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL REFERENCES games(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, agent_id)
  );

  -- Seed games
  INSERT OR IGNORE INTO games (id, name, description, turn_timeout_sec) VALUES
    ('tictactoe', 'Tic-Tac-Toe', 'Classic 3x3 grid. Get three in a row to win.', 15),
    ('chess', 'Chess', 'Standard chess. Checkmate your opponent.', 60);
`);

export default db;
