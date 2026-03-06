import { Router } from 'express';
import db from '../db/index.js';
import { authMiddleware, AuthedRequest } from '../middleware/auth.js';
import { createBattle, playTurn, getBattleState, formatView, destroyBattle, getRawBattleLog } from '../engines/pokemon.js';
import { getAIMove } from '../services/ai-opponent.js';
import { calculateElo } from '../services/elo.js';
import { reportToRoC } from '../services/roc.js';
import { v4 as uuid } from 'uuid';
import type { Response } from 'express';

const router = Router();
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_TURN_TIMEOUT_SEC = 120;

function getPokemonLimits() {
  const row = db.prepare('SELECT max_turns, turn_timeout_sec FROM games WHERE id = ?').get('pokemon') as any;
  return {
    maxTurns: row?.max_turns || DEFAULT_MAX_TURNS,
    turnTimeoutSec: row?.turn_timeout_sec || DEFAULT_TURN_TIMEOUT_SEC,
  };
}

function hpRatio(condition: string): number {
  if (!condition || condition.includes('fnt') || condition === '0') return 0;
  const m = condition.match(/(\d+)\/(\d+)/);
  if (!m) return 1;
  const cur = parseInt(m[1], 10);
  const max = parseInt(m[2], 10);
  if (!max) return 0;
  return cur / max;
}

function teamHpScore(pokemons: any[] = []): number {
  return pokemons.reduce((acc, p) => acc + hpRatio(String(p?.condition || '0')), 0);
}

async function settleEloAndReport(match: any, winnerId: number | null, matchResult: string, matchId: string) {
  const r1 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player1_id, 'pokemon') as any;
  const r2 = db.prepare('SELECT elo FROM ratings WHERE agent_id = ? AND game_id = ?').get(match.player2_id, 'pokemon') as any;
  if (!r1 || !r2) return;

  const score1 = winnerId === match.player1_id ? 1 : winnerId === match.player2_id ? 0 : 0.5;
  const { newA, newB } = calculateElo(r1.elo, r2.elo, score1);
  const w1 = score1 === 1 ? 'wins' : score1 === 0 ? 'losses' : 'draws';
  const w2 = score1 === 0 ? 'wins' : score1 === 1 ? 'losses' : 'draws';
  db.prepare(`UPDATE ratings SET elo = ?, ${w1} = ${w1} + 1 WHERE agent_id = ? AND game_id = ?`).run(newA, match.player1_id, 'pokemon');
  db.prepare(`UPDATE ratings SET elo = ?, ${w2} = ${w2} + 1 WHERE agent_id = ? AND game_id = ?`).run(newB, match.player2_id, 'pokemon');

  const p1 = db.prepare('SELECT * FROM agents WHERE id = ?').get(match.player1_id) as any;
  const p2 = db.prepare('SELECT * FROM agents WHERE id = ?').get(match.player2_id) as any;
  await reportToRoC({
    gateway_id: p1.gateway_id,
    agent_name: p1.agent_name,
    game: 'pokemon',
    result: (score1 === 1 ? 'win' : score1 === 0 ? 'loss' : 'draw') as any,
    opponent_gateway_id: p2.gateway_id,
    opponent_name: p2.agent_name,
    elo_before: r1.elo,
    elo_after: newA,
    match_id: matchId
  });
}

async function enforceInactivityTimeout(match: any): Promise<boolean> {
  if (!match || match.status !== 'active') return false;
  const { turnTimeoutSec } = getPokemonLimits();
  const lastMove = db.prepare('SELECT created_at FROM moves WHERE match_id = ? ORDER BY id DESC LIMIT 1').get(match.id) as any;
  const lastTime = lastMove?.created_at ? new Date(`${lastMove.created_at}Z`).getTime() : new Date(`${match.started_at}Z`).getTime();
  const elapsedSec = (Date.now() - lastTime) / 1000;
  if (elapsedSec <= turnTimeoutSec) return false;

  const winnerId = match.player2_id; // solo mode: human inactivity => AI win
  db.prepare(`UPDATE matches SET status = 'completed', winner_id = ?, result = 'timeout', finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(winnerId, match.id);
  await settleEloAndReport(match, winnerId, 'timeout', match.id);
  destroyBattle(match.id);
  return true;
}

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
  const limits = getPokemonLimits();

  res.json({ match_id: matchId, game_id: 'pokemon', opponent: modelName, battle_view: p1View, your_turn: true,
    instructions: 'Use "move 1-4" to attack or "switch 1-6" to switch Pokemon. Max turns and timeout are enforced; at max turns, highest remaining HP% wins.',
    limits: { max_turns: limits.maxTurns, turn_timeout_sec: limits.turnTimeoutSec, turns_remaining: limits.maxTurns } });
});

// POST /api/pokemon/:matchId/auto - Auto-play turn for 2-agent matches
// Called by agents to process both players' moves automatically
router.post('/:matchId/auto', async (req: AuthedRequest, res: Response) => {
  const matchId = req.params.matchId as string;
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  if (match.status !== 'active') { res.status(400).json({ error: `Match is ${match.status}` }); return; }
  if (match.game_id !== 'pokemon') { res.status(400).json({ error: 'Not a pokemon match' }); return; }

  const battle = getBattleState(matchId);
  if (!battle) {
    // Battle not in memory - try to restore from database or create new
    try {
      const { p1View, p2View } = await createBattle(matchId);
      const newBattle = getBattleState(matchId);
      if (!newBattle) { res.status(500).json({ error: 'Failed to restore battle' }); return; }
      // Battle restored but no moves yet - return initial state
      res.json({ match_id: matchId, battle_view: p1View, status: 'active', turn: 1, message: 'Battle initialized' });
      return;
    } catch (e) { res.status(500).json({ error: 'Battle expired from memory' }); return; }
  }

  const limits = getPokemonLimits();

  // Check for force switches
  const p1ForceSwitch = battle.p1Request?.forceSwitch?.[0];
  const p2ForceSwitch = battle.p2Request?.forceSwitch?.[0];

  // Get P1 move (or force switch)
  let p1Command: string;
  if (p1ForceSwitch) {
    const alive = battle.p1Request.side.pokemon
      .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
      .filter((p: any) => !p.active && p.condition !== '0 fnt');
    p1Command = `switch ${alive[Math.floor(Math.random() * alive.length)]?.slot || 2}`;
  } else {
    // Safely get a valid move - prioritize non-disabled moves
    const moves = battle.p1Request?.active?.[0]?.moves || [];
    const validMoves = moves
      .map((m: any, i: number) => ({ ...m, idx: i + 1 }))
      .filter((m: any) => !m.disabled);
    
    if (validMoves.length > 0) {
      // Try AI first
      const p1View = formatView(battle.p1Request);
      try {
        const p1Result = await getAIMove('pokemon', p1View, '', 1, []);
        const mv = p1Result.move.toLowerCase().trim();
        if (/^move [1-4]$/.test(mv)) {
          const moveNum = parseInt(mv.replace('move ', ''));
          if (moves[moveNum - 1] && !moves[moveNum - 1].disabled) {
            p1Command = mv;
          } else {
            p1Command = `move ${validMoves[0].idx}`;
          }
        } else if (/^[1-4]$/.test(mv)) {
          const moveNum = parseInt(mv);
          if (moves[moveNum - 1] && !moves[moveNum - 1].disabled) {
            p1Command = `move ${moveNum}`;
          } else {
            p1Command = `move ${validMoves[0].idx}`;
          }
        } else {
          // Fall back to valid move
          p1Command = `move ${validMoves[0].idx}`;
        }
      } catch {
        p1Command = `move ${validMoves[0].idx}`;
      }
    } else {
      // No valid moves - must switch
      const alive = battle.p1Request.side.pokemon
        .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
        .filter((p: any) => !p.active && p.condition !== '0 fnt');
      p1Command = alive.length > 0 ? `switch ${alive[0].slot}` : 'move 1';
    }
  }

  // Get P2 move (or force switch)
  let p2Command: string;
  if (p2ForceSwitch) {
    const alive = battle.p2Request.side.pokemon
      .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
      .filter((p: any) => !p.active && p.condition !== '0 fnt');
    p2Command = `switch ${alive[Math.floor(Math.random() * alive.length)]?.slot || 2}`;
  } else {
    // Safely get a valid move - prioritize non-disabled moves
    const moves = battle.p2Request?.active?.[0]?.moves || [];
    const validMoves = moves
      .map((m: any, i: number) => ({ ...m, idx: i + 1 }))
      .filter((m: any) => !m.disabled);
    
    if (validMoves.length > 0) {
      // Try AI first
      const p2View = formatView(battle.p2Request);
      try {
        const p2Result = await getAIMove('pokemon', p2View, '', 2, []);
        const mv = p2Result.move.toLowerCase().trim();
        if (/^move [1-4]$/.test(mv)) {
          const moveNum = parseInt(mv.replace('move ', ''));
          if (moves[moveNum - 1] && !moves[moveNum - 1].disabled) {
            p2Command = mv;
          } else {
            p2Command = `move ${validMoves[0].idx}`;
          }
        } else if (/^[1-4]$/.test(mv)) {
          const moveNum = parseInt(mv);
          if (moves[moveNum - 1] && !moves[moveNum - 1].disabled) {
            p2Command = `move ${moveNum}`;
          } else {
            p2Command = `move ${validMoves[0].idx}`;
          }
        } else {
          // Fall back to valid move
          p2Command = `move ${validMoves[0].idx}`;
        }
      } catch {
        p2Command = `move ${validMoves[0].idx}`;
      }
    } else {
      // No valid moves - must switch
      const alive = battle.p2Request.side.pokemon
        .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
        .filter((p: any) => !p.active && p.condition !== '0 fnt');
      p2Command = alive.length > 0 ? `switch ${alive[0].slot}` : 'move 1';
    }
  }

  // Play the turn - handle errors gracefully with retry logic
  let result = await playTurn(matchId, p1Command, p2Command);
  let attempts = 0;
  
  // Retry loop for handling race conditions with force switches
  while (!result.valid && attempts < 3) {
    const currentBattle = getBattleState(matchId);
    if (!currentBattle) {
      res.status(400).json({ error: 'Battle state lost' });
      return;
    }
    
    // Check if we need to switch and haven't switched yet
    const needsP1Switch = currentBattle.p1Request?.forceSwitch?.[0];
    const needsP2Switch = currentBattle.p2Request?.forceSwitch?.[0];
    
    if (needsP1Switch && !p1Command.startsWith('switch')) {
      // Need to switch but didn't - generate switch command
      const alive = currentBattle.p1Request.side.pokemon
        .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
        .filter((p: any) => !p.active && p.condition !== '0 fnt');
      p1Command = `switch ${alive[Math.floor(Math.random() * alive.length)]?.slot || 2}`;
    }
    if (needsP2Switch && !p2Command.startsWith('switch')) {
      const alive = currentBattle.p2Request.side.pokemon
        .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
        .filter((p: any) => !p.active && p.condition !== '0 fnt');
      p2Command = `switch ${alive[Math.floor(Math.random() * alive.length)]?.slot || 2}`;
    }
    
    result = await playTurn(matchId, p1Command, p2Command);
    attempts++;
    
    if (result.valid) break;
    
    // Small delay to let state settle
    await new Promise(r => setTimeout(r, 100));
  }
  
  if (!result.valid) { 
    // Last resort - return current state
    const battle = getBattleState(matchId);
    res.status(400).json({ 
      error: result.error,
      p1_view: formatView(battle?.p1Request),
      p2_view: formatView(battle?.p2Request),
      turn: battle?.turn || 1
    }); 
    return; 
  }

  // Get battle initialization from memory
  const rawLog = getRawBattleLog(matchId);
  let initLog = '';
  if (rawLog && rawLog.length > 0) {
    initLog = rawLog.join('\n') + '\n';
  }

  // Record moves
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state, raw_battle_log) VALUES (?, ?, ?, ?, ?, ?)')
    .run(matchId, match.player1_id, result.turn, p1Command, result.battleLog || '', initLog + (result.rawBattleLog || ''));
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state, raw_battle_log) VALUES (?, ?, ?, ?, ?, ?)')
    .run(matchId, match.player2_id, result.turn, p2Command, '', initLog + (result.rawBattleLog || ''));

  // Check for winner
  if (result.winner) {
    const winnerId = result.winner === 'Player 1' ? match.player1_id : match.player2_id;
    const matchResult = result.winner === 'Player 1' ? 'player1_win' : result.winner === 'tie' ? 'draw' : 'player2_win';
    db.prepare(`UPDATE matches SET status = 'completed', winner_id = ?, result = ?, move_count = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(winnerId, matchResult, result.turn, matchId);
    await settleEloAndReport(match, winnerId, matchResult, matchId);
    destroyBattle(matchId);
    res.json({
      p1_move: p1Command,
      p2_move: p2Command,
      battle_log: result.battleLog,
      status: 'completed',
      result: matchResult,
      winner: result.winner,
      turn: result.turn,
      reason: 'normal_win',
    });
    return;
  }

  // Hard max-turn cap: decide winner by remaining HP ratio
  if (result.turn >= limits.maxTurns) {
    const current = getBattleState(matchId);
    const p1Score = teamHpScore(current?.p1Request?.side?.pokemon || []);
    const p2Score = teamHpScore(current?.p2Request?.side?.pokemon || []);
    const winnerId = p1Score > p2Score ? match.player1_id : p2Score > p1Score ? match.player2_id : null;
    const matchResult = winnerId === match.player1_id ? 'player1_win' : winnerId === match.player2_id ? 'player2_win' : 'draw';
    db.prepare(`UPDATE matches SET status = 'completed', winner_id = ?, result = ?, move_count = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(winnerId, matchResult, result.turn, matchId);
    await settleEloAndReport(match, winnerId, matchResult, matchId);
    destroyBattle(matchId);
    res.json({
      p1_move: p1Command,
      p2_move: p2Command,
      battle_log: result.battleLog,
      status: 'completed',
      result: matchResult,
      winner: winnerId === match.player1_id ? 'Player 1' : winnerId === match.player2_id ? 'Player 2' : 'tie',
      turn: result.turn,
      reason: 'max_turn_limit_hp',
      score: { p1_hp_ratio_sum: p1Score, p2_hp_ratio_sum: p2Score },
    });
    return;
  }

  // Game continues
  db.prepare('UPDATE matches SET move_count = ?, current_turn = ? WHERE id = ?').run(result.turn, result.turn, matchId);
  res.json({
    p1_move: p1Command,
    p2_move: p2Command,
    p1_view: result.p1View,
    p2_view: result.p2View,
    battle_log: result.battleLog,
    turn: result.turn,
    status: 'active',
    turns_remaining: Math.max(0, limits.maxTurns - result.turn),
  });
});

router.post('/:matchId/move', authMiddleware, async (req: AuthedRequest, res: Response) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId as string as string) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  if (await enforceInactivityTimeout(match)) {
    const ended = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId as string as string) as any;
    res.status(400).json({ error: 'Match timed out', status: ended?.status, result: ended?.result, winner_id: ended?.winner_id });
    return;
  }
  if (match.status !== 'active') { res.status(400).json({ error: `Match is ${match.status}` }); return; }

  const battle = getBattleState(req.params.matchId as string as string);
  if (!battle) { res.status(500).json({ error: 'Battle expired from memory' }); return; }

  const playerMove = req.body.move;

  // Check if player needs to force switch
  const p1ForceSwitch = battle.p1Request?.forceSwitch?.[0];
  const p2ForceSwitch = battle.p2Request?.forceSwitch?.[0];
  if (p1ForceSwitch && !/^switch [1-6]$/i.test(String(playerMove || '').trim())) {
    res.status(400).json({ error: 'Your active Pokemon fainted. You must play a switch command (example: "switch 2").' });
    return;
  }

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
  const result = await playTurn(req.params.matchId as string as string, playerMove, aiCommand);
  if (!result.valid) { res.status(400).json({ error: result.error }); return; }

  // Get battle initialization from memory
  const rawLog = getRawBattleLog(req.params.matchId as string);
  let initLog = '';
  if (rawLog && rawLog.length > 0) {
    initLog = rawLog.join('\n') + '\n';
  }
  
  // Record moves with battle log and raw battle log (prepend initialization)
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state, raw_battle_log) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.matchId as string as string, match.player1_id, result.turn, playerMove, result.battleLog || '', initLog + (result.rawBattleLog || ''));
  db.prepare('INSERT INTO moves (match_id, agent_id, move_number, move_data, board_state, raw_battle_log) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.matchId as string as string, match.player2_id, result.turn, aiCommand, '', initLog + (result.rawBattleLog || ''));

  if (result.winner) {
    const winnerId = result.winner === 'Player 1' ? match.player1_id : match.player2_id;
    const matchResult = result.winner === 'Player 1' ? 'player1_win' : result.winner === 'tie' ? 'draw' : 'player2_win';
    db.prepare(`UPDATE matches SET status = 'completed', winner_id = ?, result = ?, move_count = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(winnerId, matchResult, result.turn, req.params.matchId as string as string);

    await settleEloAndReport(match, winnerId, matchResult, req.params.matchId as string as string);
    destroyBattle(req.params.matchId as string as string);
    res.json({
      your_move: playerMove,
      ai_move: aiCommand,
      battle_log: result.battleLog,
      status: 'completed',
      result: matchResult,
      winner: result.winner,
      turn: result.turn,
      reason: 'normal_win',
      limits: { max_turns: getPokemonLimits().maxTurns, turn_timeout_sec: getPokemonLimits().turnTimeoutSec, turns_remaining: 0 },
    });
    return;
  }

  // Hard max-turn cap: decide winner by remaining HP ratio
  const limits = getPokemonLimits();
  if (result.turn >= limits.maxTurns) {
    const current = getBattleState(req.params.matchId as string as string);
    const p1Score = teamHpScore(current?.p1Request?.side?.pokemon || []);
    const p2Score = teamHpScore(current?.p2Request?.side?.pokemon || []);
    const winnerId = p1Score > p2Score ? match.player1_id : p2Score > p1Score ? match.player2_id : null;
    const matchResult = winnerId === match.player1_id ? 'player1_win' : winnerId === match.player2_id ? 'player2_win' : 'draw';
    db.prepare(`UPDATE matches SET status = 'completed', winner_id = ?, result = ?, move_count = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(winnerId, matchResult, result.turn, req.params.matchId as string as string);
    await settleEloAndReport(match, winnerId, matchResult, req.params.matchId as string as string);
    destroyBattle(req.params.matchId as string as string);
    res.json({
      your_move: playerMove,
      ai_move: aiCommand,
      battle_log: result.battleLog,
      status: 'completed',
      result: matchResult,
      winner: winnerId === match.player1_id ? 'Player 1' : winnerId === match.player2_id ? 'Player 2' : 'tie',
      turn: result.turn,
      reason: 'max_turn_limit_hp',
      score: { p1_hp_ratio_sum: p1Score, p2_hp_ratio_sum: p2Score },
      limits: { max_turns: limits.maxTurns, turn_timeout_sec: limits.turnTimeoutSec, turns_remaining: 0 },
    });
    return;
  }

  db.prepare('UPDATE matches SET move_count = ?, current_turn = ? WHERE id = ?').run(result.turn, result.turn, req.params.matchId as string);
  res.json({
    your_move: playerMove,
    ai_move: aiCommand,
    battle_view: result.p1View,
    battle_log: result.battleLog,
    turn: result.turn,
    status: 'active',
    limits: { max_turns: limits.maxTurns, turn_timeout_sec: limits.turnTimeoutSec, turns_remaining: Math.max(0, limits.maxTurns - result.turn) },
  });
});

// Task #902: GET /api/pokemon/:id/log - full battle log for replay (must be before /:matchId)
router.get('/:matchId/log', (req, res) => {
  console.log('DEBUG: /log route hit for', req.params.matchId);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId as string) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }

  // Get all moves with raw battle logs
  const moves = db.prepare('SELECT move_number, move_data, raw_battle_log FROM moves WHERE match_id = ? ORDER BY move_number').all(req.params.matchId as string) as any[];
  
  // Build the full Showdown-format battle log
  const fullLog: string[] = [];
  
  // Add initial battle setup from first move's raw log if available
  if (moves.length > 0 && moves[0].raw_battle_log) {
    const firstRaw = moves[0].raw_battle_log;
    // Extract initial lines (player info, teams, start)
    const lines = firstRaw.split('\n');
    for (const line of lines) {
      if (line.startsWith('|player|') || line.startsWith('|gametype|') || line.startsWith('|gen|') || 
          line.startsWith('|tier|') || line.startsWith('|clearpoke|') || line.startsWith('|poke|') || 
          line.startsWith('|start|') || line.startsWith('|request|')) {
        fullLog.push(line);
      }
    }
  }
  
  // Add raw battle logs from each move
  for (const move of moves) {
    if (move.raw_battle_log) {
      const lines = move.raw_battle_log.split('\n');
      for (const line of lines) {
        // Skip request lines and duplicates of setup
        if (!line.startsWith('|request|') && !line.startsWith('|player|') && 
            !line.startsWith('|gametype|') && !line.startsWith('|gen|') && 
            !line.startsWith('|tier|') && !line.startsWith('|clearpoke|') && 
            !line.startsWith('|poke|') && !line.startsWith('|start|')) {
          fullLog.push(line);
        }
      }
    }
  }
  
  // Add winner if game is completed
  if (match.status === 'completed' && match.winner_id) {
    const winner = match.result?.includes('player1') ? match.p1_name : match.p2_name;
    if (winner) {
      fullLog.push(`|win|${winner}`);
    }
  }
  
  res.json({ match_id: req.params.matchId, log: fullLog.join('\n') });
});

// Task #902 & #904: GET /api/pokemon/:id/stream - SSE for live updates (must be before /:matchId)
router.get('/:matchId/stream', (req, res) => {
  const matchId = req.params.matchId;
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', match_id: matchId })}\n\n`);

  let lastMoveCount = match.move_count || 0;
  let lastStatus = match.status;

  // Poll for changes
  const interval = setInterval(() => {
    const currentMatch = db.prepare('SELECT move_count, status, winner_id, result FROM matches WHERE id = ?').get(matchId) as any;
    if (!currentMatch) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Match not found' })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }

    // Check for new moves
    if (currentMatch.move_count > lastMoveCount) {
      const newMoves = db.prepare('SELECT move_number, move_data, raw_battle_log FROM moves WHERE match_id = ? AND move_number > ? ORDER BY move_number')
        .all(matchId, lastMoveCount) as any[];
      
      for (const move of newMoves) {
        res.write(`data: ${JSON.stringify({ 
          type: 'move', 
          move_number: move.move_number, 
          move_data: move.move_data,
          raw_battle_log: move.raw_battle_log 
        })}\n\n`);
      }
      lastMoveCount = currentMatch.move_count;
    }

    // Check for game over
    if (currentMatch.status === 'completed' && lastStatus !== 'completed') {
      res.write(`data: ${JSON.stringify({ 
        type: 'game_over', 
        status: currentMatch.status,
        result: currentMatch.result,
        winner_id: currentMatch.winner_id
      })}\n\n`);
      lastStatus = currentMatch.status;
      clearInterval(interval);
      res.end();
      return;
    }

    // Send heartbeat
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', move_count: lastMoveCount })}\n\n`);
  }, 2000);

  // Clean up on close
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

router.get('/:matchId', async (req, res) => {
  const base = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.matchId as string as string) as any;
  if (base) await enforceInactivityTimeout(base);
  const match = db.prepare(`SELECT m.*, a1.agent_name as p1_name, a2.agent_name as p2_name FROM matches m LEFT JOIN agents a1 ON m.player1_id = a1.id LEFT JOIN agents a2 ON m.player2_id = a2.id WHERE m.id = ?`).get(req.params.matchId as string as string) as any;
  if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
  const battle = getBattleState(req.params.matchId as string as string);
  const moves = db.prepare('SELECT * FROM moves WHERE match_id = ? ORDER BY move_number').all(req.params.matchId as string as string);
  const limits = getPokemonLimits();
  res.json({
    ...match,
    battle: battle ? { turn: battle.turn, winner: battle.winner, p1_pokemon: battle.p1Request?.side?.pokemon, p2_pokemon: battle.p2Request?.side?.pokemon } : null,
    moves,
    limits: { max_turns: limits.maxTurns, turn_timeout_sec: limits.turnTimeoutSec, turns_remaining: Math.max(0, limits.maxTurns - (match.move_count || 0)) },
  });
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
