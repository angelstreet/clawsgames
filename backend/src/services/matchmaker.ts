import db from '../db/index.js';
import { v4 as uuid } from 'uuid';
import { getEngine } from '../engines/index.js';

export function joinQueue(gameId: string, agentId: number): { status: 'matched' | 'waiting'; match_id?: string; position?: number } {
  // Check if already in queue
  const existing = db.prepare('SELECT id FROM queue WHERE game_id = ? AND agent_id = ?').get(gameId, agentId);
  if (existing) {
    const pos = db.prepare('SELECT COUNT(*) as cnt FROM queue WHERE game_id = ?').get(gameId) as any;
    return { status: 'waiting', position: pos.cnt };
  }

  // Check for waiting opponent
  const opponent = db.prepare('SELECT * FROM queue WHERE game_id = ? AND agent_id != ? ORDER BY created_at ASC LIMIT 1').get(gameId, agentId) as any;

  if (opponent) {
    // Match found — remove from queue, create match
    db.prepare('DELETE FROM queue WHERE id = ?').run(opponent.id);

    const engine = getEngine(gameId)!;
    const matchId = uuid();
    const initialState = engine.initialState();

    // Randomly assign sides
    const [p1, p2] = Math.random() < 0.5 ? [opponent.agent_id, agentId] : [agentId, opponent.agent_id];

    db.prepare(`
      INSERT INTO matches (id, game_id, status, player1_id, player2_id, current_turn, board_state, started_at)
      VALUES (?, ?, 'active', ?, ?, 1, ?, CURRENT_TIMESTAMP)
    `).run(matchId, gameId, p1, p2, initialState);

    // Init ratings
    for (const pid of [p1, p2]) {
      db.prepare('INSERT OR IGNORE INTO ratings (agent_id, game_id) VALUES (?, ?)').run(pid, gameId);
    }

    return { status: 'matched', match_id: matchId };
  }

  // No opponent — add to queue
  db.prepare('INSERT OR IGNORE INTO queue (game_id, agent_id) VALUES (?, ?)').run(gameId, agentId);
  const pos = db.prepare('SELECT COUNT(*) as cnt FROM queue WHERE game_id = ?').get(gameId) as any;
  return { status: 'waiting', position: pos.cnt };
}

export function leaveQueue(gameId: string, agentId: number): boolean {
  const result = db.prepare('DELETE FROM queue WHERE game_id = ? AND agent_id = ?').run(gameId, agentId);
  return result.changes > 0;
}

export function createChallenge(gameId: string, agentId: number): string {
  const engine = getEngine(gameId)!;
  const matchId = uuid();
  db.prepare(`
    INSERT INTO matches (id, game_id, status, player1_id, board_state)
    VALUES (?, ?, 'waiting', ?, ?)
  `).run(matchId, gameId, agentId, engine.initialState());
  db.prepare('INSERT OR IGNORE INTO ratings (agent_id, game_id) VALUES (?, ?)').run(agentId, gameId);
  return matchId;
}

export function joinChallenge(sessionId: string, agentId: number): { match_id: string } | { error: string } {
  const match = db.prepare('SELECT * FROM matches WHERE id = ? AND status = ?').get(sessionId, 'waiting') as any;
  if (!match) return { error: 'Session not found or already started' };
  if (match.player1_id === agentId) return { error: 'Cannot join your own challenge' };

  db.prepare(`
    UPDATE matches SET player2_id = ?, status = 'active', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(agentId, sessionId);
  db.prepare('INSERT OR IGNORE INTO ratings (agent_id, game_id) VALUES (?, ?)').run(agentId, match.game_id);
  return { match_id: sessionId };
}
