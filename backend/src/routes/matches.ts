import { reportToRoC } from '../services/roc.js';
import { Router } from 'express';
import db from '../db/index.js';
import { authMiddleware, AuthedRequest } from '../middleware/auth.js';
import { getEngine } from '../engines/index.js';
import { calculateElo } from '../services/elo.js';
import { createBattle, playTurn, getBattleState, getRawBattleLog, destroyBattle } from '../engines/pokemon.js';
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



// GET /api/matches/recent?game=<gameId>&window=100&page=1&page_size=100&search=<agent>
router.get('/recent', (req, res) => {
  const windowParam = parseInt(req.query.window as string) || 100;
  const window = [10, 100, 1000].includes(windowParam) ? windowParam : 100;
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 100, 1), 100);
  const game = req.query.game as string | undefined;
  const search = (req.query.search as string | undefined)?.trim();

  const offset = (page - 1) * pageSize;
  if (offset >= window) {
    res.json({ matches: [], page, page_size: pageSize, window, total: 0, has_more: false });
    return;
  }
  const effectiveLimit = Math.min(pageSize, window - offset);

  let baseWhere = `
    FROM matches m
    LEFT JOIN agents a1 ON m.player1_id = a1.id
    LEFT JOIN agents a2 ON m.player2_id = a2.id
    WHERE m.status = 'completed'
  `;
  const whereParams: (string | number)[] = [];
  if (game) { baseWhere += ' AND m.game_id = ?'; whereParams.push(game); }
  if (search) {
    baseWhere += ' AND (LOWER(COALESCE(a1.agent_name, \'\')) LIKE ? OR LOWER(COALESCE(a2.agent_name, \'\')) LIKE ?)';
    const pat = `%${search.toLowerCase()}%`;
    whereParams.push(pat, pat);
  }

  let query = `
    SELECT m.id, m.game_id, m.status, m.result, m.move_count, m.started_at, m.finished_at,
           a1.agent_name as player1_name, a2.agent_name as player2_name,
           m.winner_id, m.player1_id, m.player2_id
    ${baseWhere}
    ORDER BY m.finished_at DESC
    LIMIT ? OFFSET ?
  `;
  const params: (string | number)[] = [...whereParams, effectiveLimit, offset];

  const totalRows = (db.prepare(`SELECT COUNT(*) as cnt ${baseWhere}`) as any).get(...whereParams)?.cnt || 0;
  const total = Math.min(totalRows, window);
  const hasMore = offset + effectiveLimit < total;

  const matches = (db.prepare(query) as any).all(...params);
  res.json({ matches, page, page_size: pageSize, window, total, has_more: hasMore });
});

// GET /api/matches/live?game=<gameId>
router.get('/live', (req, res) => {
  const game = req.query.game as string | undefined;

  // Filter out stale matches (older than 1 hour)
  let query = `
    SELECT m.id, m.game_id, m.status, m.move_count, m.started_at,
           a1.agent_name as player1_name, a2.agent_name as player2_name
    FROM matches m
    LEFT JOIN agents a1 ON m.player1_id = a1.id
    LEFT JOIN agents a2 ON m.player2_id = a2.id
    WHERE m.status = 'active'
    AND m.started_at > datetime('now', '-1 hour')
  `;
  const params: (string | number)[] = [];
  if (game) { query += ' AND m.game_id = ?'; params.push(game); }
  query += ' ORDER BY m.started_at DESC';

  // Auto-close timed-out matches before returning
  const raw = (db.prepare(query) as any).all(...params);
  for (const m of raw) {
    const full = db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id) as any;
    if (full) checkTimeout(full);
  }

  // Re-query to exclude any just-closed matches
  const matches = (db.prepare(query) as any).all(...params);
  res.json({ matches });
});

// Get match state
router.get('/:matchId', (req, res) => {
  // Check timeout first
  const rawMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId as string) as any;
  if (rawMatch) checkTimeout(rawMatch);
  
  const match = db.prepare(`
    SELECT m.*, a1.agent_name as player1_name, a2.agent_name as player2_name,
           a1.gateway_id as player1_gw, a2.gateway_id as player2_gw
    FROM matches m
    LEFT JOIN agents a1 ON m.player1_id = a1.id
    LEFT JOIN agents a2 ON m.player2_id = a2.id
    WHERE m.id = ?
  `).get(req.params.matchId as string) as any;

  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }

  const engine = getEngine(match.game_id);
  const response: any = {
    ...match,
    board_display: engine?.formatBoard(match.board_state),
  };

  // For Pokemon games, also include battle_view
  if (match.game_id === 'pokemon' && match.board_state && match.board_state !== '{}') {
    try {
      const battleState = JSON.parse(match.board_state);
      if (battleState.p1_pokemon) {
        // Build a simple battle view from saved state
        const formatPokemonView = (pokemons: any[]) => {
          if (!pokemons || pokemons.length === 0) return '';
          const active = pokemons.find((p: any) => p.active);
          if (!active) return '';
          const name = active.details?.split(',')[0]?.trim() || 'Unknown';
          const hp = active.condition?.split('/')[0] || '?';
          return `Active: ${name}, L${active.level || '?'}, M [${hp}/${active.stats?.hp || '?'}]`;
        };
        response.battle_view = formatPokemonView(battleState.p1_pokemon);
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  res.json(response);
});

// Submit move
router.post('/:matchId/move', authMiddleware, async (req: AuthedRequest, res: Response) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId as string) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  if (match.status !== 'active') { res.status(400).json({ error: `Match is ${match.status}` }); return; }

  const agentId = req.agent!.id;
  const playerNum = match.player1_id === agentId ? 1 : match.player2_id === agentId ? 2 : 0;
  if (playerNum === 0) { res.status(403).json({ error: 'You are not in this match' }); return; }
  if (match.current_turn !== playerNum) { res.status(400).json({ error: 'Not your turn' }); return; }

  // Pokemon: route through Showdown engine (turn-based buffering: P1 stores move, P2 triggers playTurn)
  if (match.game_id === 'pokemon') {
    const playerMove = req.body.move;
    const moveNumber = match.move_count + 1;

    if (playerNum === 1) {
      // P1 stores their move; P2 will trigger the actual battle turn
      db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state) VALUES (?, ?, ?, ?, ?)')
        .run(match.id, agentId, moveNumber, playerMove, '{}');
      db.prepare('UPDATE matches SET move_count = ?, current_turn = 2 WHERE id = ?').run(moveNumber, match.id);
      res.json({ valid: true, status: 'active', current_turn: 2, message: 'Move recorded, waiting for opponent' });
      return;
    }

    // P2: find P1's pending move and process both simultaneously
    const p1Move = db.prepare(
      'SELECT * FROM moves WHERE match_id = ? AND agent_id = ? ORDER BY id DESC LIMIT 1'
    ).get(match.id, match.player1_id) as any;
    if (!p1Move) { res.status(400).json({ error: 'Waiting for P1 move first' }); return; }

    // Ensure battle is in memory (may have been lost on server restart)
    let battle = getBattleState(match.id);
    if (!battle) {
      try { await createBattle(match.id); battle = getBattleState(match.id); } catch {}
      if (!battle) { res.status(500).json({ error: 'Battle expired from memory' }); return; }
    }

    let result = await playTurn(match.id, p1Move.move_data, playerMove);
    if (!result.valid) { res.status(400).json({ error: result.error }); return; }

    const rawLog = getRawBattleLog(match.id);
    const initLog = rawLog && rawLog.length > 0 ? rawLog.join('\n') + '\n' : '';
    const combinedLog = initLog + (result.rawBattleLog || '');

    // Update P1's pending move with real board_state and raw log
    db.prepare('UPDATE moves SET board_state = ?, raw_battle_log = ? WHERE id = ?')
      .run(result.battleLog || '', combinedLog, p1Move.id);
    // Insert P2's move
    db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state, raw_battle_log) VALUES (?, ?, ?, ?, ?, ?)')
      .run(match.id, agentId, moveNumber + 1, playerMove, '', combinedLog);

    if (result.winner) {
      const winnerId = result.winner === 'Player 1' ? match.player1_id : match.player2_id;
      const matchResult = result.winner === 'tie' ? 'draw' : (result.winner === 'Player 1' ? 'player1_win' : 'player2_win');
      db.prepare(`UPDATE matches SET status='completed', winner_id=?, result=?, move_count=?, finished_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(winnerId, matchResult, result.turn, match.id);

      const r1 = db.prepare('SELECT elo FROM ratings WHERE agent_id=? AND game_id=?').get(match.player1_id, 'pokemon') as any;
      const r2 = db.prepare('SELECT elo FROM ratings WHERE agent_id=? AND game_id=?').get(match.player2_id, 'pokemon') as any;
      if (r1 && r2) {
        const score1 = winnerId === match.player1_id ? 1 : winnerId === match.player2_id ? 0 : 0.5;
        const { newA, newB } = calculateElo(r1.elo, r2.elo, score1);
        const w1 = score1 === 1 ? 'wins' : score1 === 0 ? 'losses' : 'draws';
        const w2 = score1 === 0 ? 'wins' : score1 === 1 ? 'losses' : 'draws';
        db.prepare(`UPDATE ratings SET elo=?, ${w1}=${w1}+1 WHERE agent_id=? AND game_id=?`).run(newA, match.player1_id, 'pokemon');
        db.prepare(`UPDATE ratings SET elo=?, ${w2}=${w2}+1 WHERE agent_id=? AND game_id=?`).run(newB, match.player2_id, 'pokemon');
      }

      // Save final state
      const finalBattle = getBattleState(match.id);
      if (finalBattle) {
        const finalState = JSON.stringify({ turn: finalBattle.turn, winner: finalBattle.winner, p1_pokemon: finalBattle.p1Request?.side?.pokemon, p2_pokemon: finalBattle.p2Request?.side?.pokemon });
        db.prepare('UPDATE matches SET board_state=? WHERE id=?').run(finalState, match.id);
      }
      destroyBattle(match.id);
      res.json({ valid: true, status: 'completed', result: matchResult, winner: result.winner, turn: result.turn });
      return;
    }

    db.prepare('UPDATE matches SET move_count=?, current_turn=1 WHERE id=?').run(result.turn, match.id);
    res.json({ valid: true, status: 'active', current_turn: 1, battle_log: result.battleLog, turn: result.turn });
    return;
  }

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
  `).all(req.params.matchId as string);
  res.json({ moves });
});

export default router;
