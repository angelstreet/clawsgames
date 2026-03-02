/**
 * Solo Play routes — play against an AI model
 * POST /api/games/:gameId/solo         → start solo match (pick model)
 * POST /api/solo/:matchId/move         → make your move (AI responds automatically)
 * GET  /api/solo/models                → list available AI opponents
 */
import { Router } from 'express';
import db from '../db/index.js';
import { authMiddleware, AuthedRequest } from '../middleware/auth.js';
import { getEngine } from '../engines/index.js';
import { getAIMove, getAvailableModels } from '../services/ai-opponent.js';
import { calculateElo } from '../services/elo.js';
import { reportToRoC } from '../services/roc.js';
import { v4 as uuid } from 'uuid';
import type { Response } from 'express';

const router = Router();

// List AI models
router.get('/models', (_req, res) => {
  res.json({ models: getAvailableModels() });
});

// Start solo match
router.post('/:gameId/solo', authMiddleware, (req: AuthedRequest, res: Response) => {
  const gameId = req.params.gameId;
  const engine = getEngine(gameId);
  if (!engine) { res.status(404).json({ error: 'Game not found' }); return; }

  const modelId = (req.body.model as string) || undefined;
  const modelName = modelId
    ? getAvailableModels().find(m => m.id === modelId)?.name || modelId.split('/').pop() || 'AI'
    : 'Gemini Flash';

  // Create AI agent entry
  const aiGatewayId = `ai-${modelId || 'default'}`;
  db.prepare(`
    INSERT OR IGNORE INTO agents (gateway_id, agent_name, country)
    VALUES (?, ?, 'AI')
  `).run(aiGatewayId, `AI: ${modelName}`);
  const aiAgent = db.prepare('SELECT * FROM agents WHERE gateway_id = ?').get(aiGatewayId) as any;

  const matchId = uuid();
  const initialState = engine.initialState();

  // Human is always player 1
  db.prepare(`
    INSERT INTO matches (id, game_id, status, player1_id, player2_id, current_turn, board_state, started_at)
    VALUES (?, ?, 'active', ?, ?, 1, ?, CURRENT_TIMESTAMP)
  `).run(matchId, gameId, req.agent!.id, aiAgent.id, initialState);

  // Store model choice in a simple way (we'll use match metadata)
  db.prepare('INSERT OR IGNORE INTO ratings (agent_id, game_id) VALUES (?, ?)').run(req.agent!.id, gameId);
  db.prepare('INSERT OR IGNORE INTO ratings (agent_id, game_id) VALUES (?, ?)').run(aiAgent.id, gameId);

  res.json({
    match_id: matchId,
    game_id: gameId,
    opponent: modelName,
    model_id: modelId || 'google/gemini-2.0-flash-exp:free',
    board_display: engine.formatBoard(initialState),
    your_turn: true,
  });
});

// Make move in solo match (AI auto-responds)
router.post('/:matchId/move', authMiddleware, async (req: AuthedRequest, res: Response) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  if (match.status !== 'active') { res.status(400).json({ error: `Match is ${match.status}` }); return; }
  if (match.player1_id !== req.agent!.id) { res.status(403).json({ error: 'Not your match' }); return; }
  if (match.current_turn !== 1) { res.status(400).json({ error: 'Not your turn' }); return; }

  const engine = getEngine(match.game_id);
  if (!engine) { res.status(500).json({ error: 'Engine not found' }); return; }

  // Validate human move
  const humanMove = engine.validateMove(match.board_state, req.body.move, 1);
  if (!humanMove.valid) { res.status(400).json({ error: humanMove.error }); return; }

  let state = humanMove.newState!;
  const moveNum = match.move_count + 1;

  // Record human move
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state) VALUES (?, ?, ?, ?, ?)')
    .run(match.id, req.agent!.id, moveNum, req.body.move, state);

  // Check if human won
  let gameOver = engine.isGameOver(state);
  if (gameOver.over) {
    return finishMatch(match, state, moveNum, gameOver, engine, res);
  }

  // AI's turn
  const aiAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(match.player2_id) as any;
  const modelId = aiAgent.gateway_id.replace('ai-', '');
  const moveHistory = db.prepare('SELECT move_data FROM moves WHERE match_id = ? ORDER BY move_number').all(match.id) as any[];

  const aiResult = await getAIMove(
    match.game_id,
    engine.formatBoard(state),
    state,
    2,
    moveHistory.map((m: any) => m.move_data),
    modelId === 'default' ? undefined : modelId,
  );

  // Validate AI move (retry with fallback if invalid)
  let aiMoveResult = engine.validateMove(state, aiResult.move, 2);
  let aiMoveData = aiResult.move;
  let retries = 0;

  while (!aiMoveResult.valid && retries < 3) {
    // AI gave invalid move — try random valid move
    if (match.game_id === 'tictactoe') {
      const available = state.split('').map((c, i) => c === '.' ? String(i) : null).filter(Boolean);
      aiMoveData = available[Math.floor(Math.random() * available.length)]!;
    } else {
      // For chess, try common moves
      const fallbacks = ['e5', 'd5', 'Nf6', 'c5', 'e6', 'Nc6', 'a6', 'g6'];
      aiMoveData = fallbacks[retries];
    }
    aiMoveResult = engine.validateMove(state, aiMoveData, 2);
    retries++;
  }

  if (!aiMoveResult.valid) {
    // AI completely failed — forfeit
    db.prepare(`UPDATE matches SET board_state = ?, move_count = ?, status = 'completed', winner_id = ?, result = 'ai_forfeit', finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(state, moveNum, req.agent!.id, match.id);
    updateElo(match, 1);
    res.json({
      your_move: req.body.move,
      ai_move: null,
      ai_error: 'AI failed to make valid move — you win by forfeit!',
      board_display: engine.formatBoard(state),
      status: 'completed',
      result: 'ai_forfeit',
      model_used: aiResult.model_used,
    });
    return;
  }

  state = aiMoveResult.newState!;
  const aiMoveNum = moveNum + 1;

  // Record AI move
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state) VALUES (?, ?, ?, ?, ?)')
    .run(match.id, match.player2_id, aiMoveNum, aiMoveData, state);

  // Check if AI won
  gameOver = engine.isGameOver(state);
  if (gameOver.over) {
    const winnerId = gameOver.winner
      ? (gameOver.winner === 1 ? match.player1_id : match.player2_id)
      : null;
    const result = gameOver.winner
      ? (gameOver.winner === 1 ? 'player1_win' : 'player2_win')
      : 'draw';

    db.prepare(`UPDATE matches SET board_state = ?, move_count = ?, status = 'completed', winner_id = ?, result = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(state, aiMoveNum, winnerId, result, match.id);
    updateElo(match, gameOver.winner === 1 ? 1 : gameOver.winner === 2 ? 0 : 0.5);

    res.json({
      your_move: req.body.move,
      ai_move: aiMoveData,
      board_display: engine.formatBoard(state),
      status: 'completed',
      result,
      reason: gameOver.reason,
      model_used: aiResult.model_used,
      fallback: aiResult.fallback,
    });
    return;
  }

  // Game continues
  db.prepare('UPDATE matches SET board_state = ?, move_count = ?, current_turn = 1 WHERE id = ?')
    .run(state, aiMoveNum, match.id);

  res.json({
    your_move: req.body.move,
    ai_move: aiMoveData,
    board_display: engine.formatBoard(state),
    status: 'active',
    your_turn: true,
    move_count: aiMoveNum,
    model_used: aiResult.model_used,
    fallback: aiResult.fallback,
  });
});

function finishMatch(match: any, state: string, moveNum: number, gameOver: any, engine: any, res: Response) {
  const winnerId = gameOver.winner
    ? (gameOver.winner === 1 ? match.player1_id : match.player2_id)
    : null;
  const result = gameOver.winner
    ? (gameOver.winner === 1 ? 'player1_win' : 'player2_win')
    : 'draw';

  db.prepare(`UPDATE matches SET board_state = ?, move_count = ?, status = 'completed', winner_id = ?, result = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(state, moveNum, winnerId, result, match.id);
  updateElo(match, gameOver.winner === 1 ? 1 : gameOver.winner === 2 ? 0 : 0.5);

  res.json({
    your_move: null,
    board_display: engine.formatBoard(state),
    status: 'completed',
    result,
    reason: gameOver.reason,
  });
}

function updateElo(match: any, score1: number) {
  const r1 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player1_id, match.game_id) as any;
  const r2 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player2_id, match.game_id) as any;
  if (!r1 || !r2) return;
  const { newA, newB } = calculateElo(r1.elo, r2.elo, score1);

  const w1 = score1 === 1 ? 'wins' : score1 === 0 ? 'losses' : 'draws';
  const w2 = score1 === 0 ? 'wins' : score1 === 1 ? 'losses' : 'draws';
  db.prepare(`UPDATE ratings SET elo = ?, ${w1} = ${w1} + 1 WHERE agent_id = ? AND game_id = ?`).run(newA, match.player1_id, match.game_id);
  db.prepare(`UPDATE ratings SET elo = ?, ${w2} = ${w2} + 1 WHERE agent_id = ? AND game_id = ?`).run(newB, match.player2_id, match.game_id);

  // Report to RoC
  const p1 = db.prepare('SELECT * FROM agents WHERE id = ?').get(match.player1_id) as any;
  const p2 = db.prepare('SELECT * FROM agents WHERE id = ?').get(match.player2_id) as any;
  const r1Result = score1 === 1 ? 'win' : score1 === 0 ? 'loss' : 'draw';
  const r2Result = score1 === 0 ? 'win' : score1 === 1 ? 'loss' : 'draw';
  reportToRoC({ gateway_id: p1.gateway_id, agent_name: p1.agent_name, game: match.game_id, result: r1Result as any, opponent_gateway_id: p2.gateway_id, opponent_name: p2.agent_name, elo_before: r1.elo, elo_after: newA, match_id: match.id });
  reportToRoC({ gateway_id: p2.gateway_id, agent_name: p2.agent_name, game: match.game_id, result: r2Result as any, opponent_gateway_id: p1.gateway_id, opponent_name: p1.agent_name, elo_before: r2.elo, elo_after: newB, match_id: match.id });
}

export default router;
