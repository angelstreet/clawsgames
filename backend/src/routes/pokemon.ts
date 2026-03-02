import { Router } from 'express';
import db from '../db/index.js';
import { authMiddleware, AuthedRequest } from '../middleware/auth.js';
import { createBattle, playTurn, getBattleState, formatView, destroyBattle } from '../engines/pokemon.js';
import { getAIMove } from '../services/ai-opponent.js';
import { calculateElo } from '../services/elo.js';
import { reportToRoC } from '../services/roc.js';
import { v4 as uuid } from 'uuid';
import type { Response } from 'express';

const router = Router();

router.post('/solo', authMiddleware, async (req: AuthedRequest, res: Response) => {
  const matchId = uuid();
  const modelName = 'Trinity Large';
  const aiGatewayId = `ai-pokemon-default`;
  db.prepare(`INSERT OR IGNORE INTO agents (gateway_id, agent_name, country) VALUES (?, ?, 'AI')`).run(aiGatewayId, `AI: ${modelName}`);
  const aiAgent = db.prepare('SELECT * FROM agents WHERE gateway_id = ?').get(aiGatewayId) as any;

  db.prepare(`INSERT INTO matches (id, game_id, status, player1_id, player2_id, current_turn, board_state, started_at) VALUES (?, 'pokemon', 'active', ?, ?, 1, '{}', CURRENT_TIMESTAMP)`)
    .run(matchId, req.agent!.id, aiAgent.id);
  db.prepare('INSERT OR IGNORE INTO ratings (agent_id, game_id) VALUES (?, ?)').run(req.agent!.id, 'pokemon');
  db.prepare('INSERT OR IGNORE INTO ratings (agent_id, game_id) VALUES (?, ?)').run(aiAgent.id, 'pokemon');

  const { p1View } = await createBattle(matchId);

  res.json({ match_id: matchId, game_id: 'pokemon', opponent: modelName, battle_view: p1View, your_turn: true,
    instructions: 'Use "move 1-4" to attack or "switch 1-6" to switch Pokemon.' });
});

router.post('/:matchId/move', authMiddleware, async (req: AuthedRequest, res: Response) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  if (match.status !== 'active') { res.status(400).json({ error: `Match is ${match.status}` }); return; }

  const battle = getBattleState(req.params.matchId);
  if (!battle) { res.status(500).json({ error: 'Battle expired from memory' }); return; }

  const playerMove = req.body.move;

  // Check if player needs to force switch
  const p1ForceSwitch = battle.p1Request?.forceSwitch?.[0];
  const p2ForceSwitch = battle.p2Request?.forceSwitch?.[0];

  // Get AI move
  let aiCommand: string;
  if (p2ForceSwitch) {
    const alive = battle.p2Request.side.pokemon
      .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
      .filter((p: any) => !p.active && p.condition !== '0 fnt');
    aiCommand = `switch ${alive[Math.floor(Math.random() * alive.length)]?.slot || 2}`;
  } else {
    // Format AI's view for the LLM
    const aiView = formatView(battle.p2Request);
    const aiResult = await getAIMove('pokemon', aiView, '', 2, []);
    
    const mv = aiResult.move.toLowerCase().trim();
    if (/^move [1-4]$/.test(mv) || /^switch [1-6]$/.test(mv)) {
      aiCommand = mv;
    } else if (/^[1-4]$/.test(mv)) {
      aiCommand = `move ${mv}`;
    } else {
      const moves = battle.p2Request?.active?.[0]?.moves;
      const idx = moves?.findIndex((m: any) => m.move.toLowerCase().includes(mv) && !m.disabled);
      aiCommand = idx >= 0 ? `move ${idx + 1}` : `move ${(moves?.findIndex((m: any) => !m.disabled) ?? 0) + 1}`;
    }
  }

  // Play the turn (both moves at once)
  const result = await playTurn(req.params.matchId, playerMove, aiCommand);
  if (!result.valid) { res.status(400).json({ error: result.error }); return; }

  // Record moves with battle log
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.matchId, match.player1_id, result.turn, playerMove, result.battleLog || '');
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.matchId, match.player2_id, result.turn, aiCommand, '');

  if (result.winner) {
    const winnerId = result.winner === 'Player 1' ? match.player1_id : match.player2_id;
    const matchResult = result.winner === 'Player 1' ? 'player1_win' : result.winner === 'tie' ? 'draw' : 'player2_win';
    db.prepare(`UPDATE matches SET status = 'completed', winner_id = ?, result = ?, move_count = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(winnerId, matchResult, result.turn, req.params.matchId);

    // ELO + RoC
    const r1 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player1_id, 'pokemon') as any;
    const r2 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player2_id, 'pokemon') as any;
    if (r1 && r2) {
      const score1 = result.winner === 'Player 1' ? 1 : result.winner === 'tie' ? 0.5 : 0;
      const { newA, newB } = calculateElo(r1.elo, r2.elo, score1);
      const w1 = score1 === 1 ? 'wins' : score1 === 0 ? 'losses' : 'draws';
      const w2 = score1 === 0 ? 'wins' : score1 === 1 ? 'losses' : 'draws';
      db.prepare(`UPDATE ratings SET elo = ?, ${w1} = ${w1} + 1 WHERE agent_id = ? AND game_id = ?`).run(newA, match.player1_id, 'pokemon');
      db.prepare(`UPDATE ratings SET elo = ?, ${w2} = ${w2} + 1 WHERE agent_id = ? AND game_id = ?`).run(newB, match.player2_id, 'pokemon');
      const p1 = db.prepare('SELECT * FROM agents WHERE id = ?').get(match.player1_id) as any;
      const p2 = db.prepare('SELECT * FROM agents WHERE id = ?').get(match.player2_id) as any;
      reportToRoC({ gateway_id: p1.gateway_id, agent_name: p1.agent_name, game: 'pokemon', result: (score1 === 1 ? 'win' : score1 === 0 ? 'loss' : 'draw') as any, opponent_gateway_id: p2.gateway_id, opponent_name: p2.agent_name, elo_before: r1.elo, elo_after: newA, match_id: req.params.matchId });
    }
    destroyBattle(req.params.matchId);
    res.json({ your_move: playerMove, ai_move: aiCommand, battle_log: result.battleLog, status: 'completed', result: matchResult, winner: result.winner, turn: result.turn });
    return;
  }

  db.prepare('UPDATE matches SET move_count = ?, current_turn = 1 WHERE id = ?').run(result.turn, req.params.matchId);
  res.json({ your_move: playerMove, ai_move: aiCommand, battle_view: result.p1View, battle_log: result.battleLog, turn: result.turn, status: 'active' });
});

router.get('/:matchId', (req, res) => {
  const match = db.prepare(`SELECT m.*, a1.agent_name as p1_name, a2.agent_name as p2_name FROM matches m LEFT JOIN agents a1 ON m.player1_id = a1.id LEFT JOIN agents a2 ON m.player2_id = a2.id WHERE m.id = ?`).get(req.params.matchId) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  const battle = getBattleState(req.params.matchId);
  const moves = db.prepare('SELECT * FROM moves WHERE match_id = ? ORDER BY move_number').all(req.params.matchId);
  res.json({ ...match, battle: battle ? { turn: battle.turn, winner: battle.winner, p1_pokemon: battle.p1Request?.side?.pokemon, p2_pokemon: battle.p2Request?.side?.pokemon } : null, moves });
});

export default router;

// List recent pokemon matches
router.get('/', (_req, res) => {
  const matches = (db.prepare(`
    SELECT m.id, m.status, m.result, m.move_count, m.started_at, m.finished_at,
           a1.agent_name as p1_name, a2.agent_name as p2_name
    FROM matches m
    LEFT JOIN agents a1 ON m.player1_id = a1.id
    LEFT JOIN agents a2 ON m.player2_id = a2.id
    WHERE m.game_id = 'pokemon'
    ORDER BY m.started_at DESC
    LIMIT 20
  `).all() as any[]).map(m => ({ ...m, game_id: 'pokemon' }));
  res.json({ matches });
});
