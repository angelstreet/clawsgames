import { reportToRoC } from '../services/roc.js';
import { Router } from 'express';
import db from '../db/index.js';
import { authMiddleware, AuthedRequest } from '../middleware/auth.js';
import { getEngine } from '../engines/index.js';
import { calculateElo } from '../services/elo.js';
import type { Response } from 'express';

const router = Router();

// Check and enforce turn timeout
function checkTimeout(match: any): boolean {
  if (match.status !== 'active') return false;
  const game = db.prepare('SELECT turn_timeout_sec FROM games WHERE id = ?').get(match.game_id) as any;
  if (!game) return false;
  
  const lastMove = db.prepare('SELECT created_at FROM moves WHERE match_id = ? ORDER BY move_number DESC LIMIT 1').get(match.id) as any;
  const lastTime = lastMove ? new Date(lastMove.created_at + 'Z').getTime() : new Date(match.started_at + 'Z').getTime();
  const elapsed = (Date.now() - lastTime) / 1000;
  
  if (elapsed > game.turn_timeout_sec) {
    // Current player forfeits
    const loserId = match.current_turn === 1 ? match.player1_id : match.player2_id;
    const winnerId = match.current_turn === 1 ? match.player2_id : match.player1_id;
    db.prepare("UPDATE matches SET status = 'completed', winner_id = ?, result = 'timeout', finished_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(winnerId, match.id);
    return true;
  }
  return false;
}


// Get match state
router.get('/:matchId', (req, res) => {
  // Check timeout first
  const rawMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId) as any;
  if (rawMatch) checkTimeout(rawMatch);
  
  const match = db.prepare(`
    SELECT m.*, a1.agent_name as player1_name, a2.agent_name as player2_name,
           a1.gateway_id as player1_gw, a2.gateway_id as player2_gw
    FROM matches m
    LEFT JOIN agents a1 ON m.player1_id = a1.id
    LEFT JOIN agents a2 ON m.player2_id = a2.id
    WHERE m.id = ?
  `).get(req.params.matchId) as any;

  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }

  const engine = getEngine(match.game_id);
  res.json({
    ...match,
    board_display: engine?.formatBoard(match.board_state),
  });
});

// Submit move
router.post('/:matchId/move', authMiddleware, (req: AuthedRequest, res: Response) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  if (match.status !== 'active') { res.status(400).json({ error: `Match is ${match.status}` }); return; }

  const agentId = req.agent!.id;
  const playerNum = match.player1_id === agentId ? 1 : match.player2_id === agentId ? 2 : 0;
  if (playerNum === 0) { res.status(403).json({ error: 'You are not in this match' }); return; }
  if (match.current_turn !== playerNum) { res.status(400).json({ error: 'Not your turn' }); return; }

  const engine = getEngine(match.game_id);
  if (!engine) { res.status(500).json({ error: 'Engine not found' }); return; }

  const moveResult = engine.validateMove(match.board_state, req.body.move, playerNum as 1 | 2);
  if (!moveResult.valid) { res.status(400).json({ error: moveResult.error }); return; }

  const newState = moveResult.newState!;
  const moveNumber = match.move_count + 1;
  const nextTurn = playerNum === 1 ? 2 : 1;

  // Record move
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state) VALUES (?, ?, ?, ?, ?)')
    .run(match.id, agentId, moveNumber, req.body.move, newState);

  // Check game over
  const gameOver = engine.isGameOver(newState);

  if (gameOver.over) {
    const winnerId = gameOver.winner
      ? (gameOver.winner === 1 ? match.player1_id : match.player2_id)
      : null;
    const result = gameOver.winner
      ? (gameOver.winner === 1 ? 'player1_win' : 'player2_win')
      : 'draw';

    db.prepare(`
      UPDATE matches SET board_state = ?, move_count = ?, status = 'completed',
      winner_id = ?, result = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newState, moveNumber, winnerId, result, match.id);

    // Update ELO
    const r1 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player1_id, match.game_id) as any;
    const r2 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player2_id, match.game_id) as any;
    const score1 = gameOver.winner === 1 ? 1 : gameOver.winner === 2 ? 0 : 0.5;
    const { newA, newB } = calculateElo(r1.elo, r2.elo, score1);

    const winCol = gameOver.winner === 1 ? 'wins' : gameOver.winner === 2 ? 'losses' : 'draws';
    const loseCol = gameOver.winner === 2 ? 'wins' : gameOver.winner === 1 ? 'losses' : 'draws';
    db.prepare(`UPDATE ratings SET elo = ?, ${winCol} = ${winCol} + 1 WHERE agent_id = ? AND game_id = ?`).run(newA, match.player1_id, match.game_id);
    db.prepare(`UPDATE ratings SET elo = ?, ${loseCol} = ${loseCol} + 1 WHERE agent_id = ? AND game_id = ?`).run(newB, match.player2_id, match.game_id);

    res.json({
      valid: true, board_state: newState, board_display: engine.formatBoard(newState),
      status: 'completed', result, winner_id: winnerId, reason: gameOver.reason,
    });
    return;
  }

  // Game continues
  db.prepare('UPDATE matches SET board_state = ?, move_count = ?, current_turn = ? WHERE id = ?')
    .run(newState, moveNumber, nextTurn, match.id);

  res.json({
    valid: true, board_state: newState, board_display: engine.formatBoard(newState),
    status: 'active', current_turn: nextTurn, move_count: moveNumber,
  });
});

// Move history
router.get('/:matchId/moves', (req, res) => {
  const moves = db.prepare(`
    SELECT m.*, a.agent_name FROM moves m
    JOIN agents a ON m.agent_id = a.id
    WHERE m.match_id = ? ORDER BY m.move_number
  `).all(req.params.matchId);
  res.json({ moves });
});

export default router;
