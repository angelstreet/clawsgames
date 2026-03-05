import { BattleStreams, Teams } from '@pkmn/sim';
// @ts-ignore
import { TeamGenerators } from '@pkmn/randoms';
import type { GameEngine, MoveResult, GameOverResult } from './types.js';

Teams.setGeneratorFactory(TeamGenerators);

interface BattleInstance {
  streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
  p1Request: any;
  p2Request: any;
  winner: string | null;
  turn: number;
  log: string[];
}

const battles = new Map<string, BattleInstance>();

async function drainStream(stream: any, timeoutMs = 500): Promise<string> {
  let out = '';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const chunk = await Promise.race([
      stream.read(),
      new Promise<null>(r => setTimeout(() => r(null), 100))
    ]);
    if (chunk === null) break;
    out += chunk + '\n';
    if (out.includes('|request|') || out.includes('|win|') || out.includes('|tie|')) break;
  }
  return out;
}

function parseRequest(raw: string): any {
  const line = raw.split('\n').find(l => l.startsWith('|request|'));
  if (!line) return null;
  try { return JSON.parse(line.replace('|request|', '')); } catch { return null; }
}

function parseWinner(raw: string): string | null {
  const line = raw.split('\n').find(l => l.startsWith('|win|'));
  if (line) return line.replace('|win|', '');
  if (raw.includes('|tie|')) return 'tie';
  return null;
}

function parseError(raw: string): string | null {
  const line = raw.split('\n').find(l => l.startsWith('|error|'));
  if (!line) return null;
  return line.replace('|error|', '').trim();
}

function parseTurn(raw: string): number | null {
  const turns = raw
    .split('\n')
    .filter(l => l.startsWith('|turn|'))
    .map(l => Number(l.replace('|turn|', '').trim()))
    .filter(n => Number.isFinite(n) && n > 0);
  if (turns.length === 0) return null;
  return Math.max(...turns);
}

function parseBattleLog(raw: string): string {
  return raw.split('\n')
    .filter(l => /^\|(move|switch|-damage|-heal|faint|-supereffective|-resisted|-crit|-miss|turn|win|tie)\|/.test(l))
    .map(l => l.split('|').filter(Boolean).join(' '))
    .join('\n');
}

export function formatView(req: any): string {
  if (!req) return 'Waiting...';
  const lines: string[] = [];
  
  if (req.forceSwitch) {
    lines.push('** You must switch Pokemon! **\n');
  }

  if (req.side?.pokemon) {
    const active = req.side.pokemon.find((p: any) => p.active);
    if (active) {
      lines.push(`Active: ${active.details} [${active.condition}]`);
    }
    lines.push('\nTeam:');
    req.side.pokemon.forEach((p: any, i: number) => {
      const status = p.active ? ' (active)' : p.condition === '0 fnt' ? ' (fainted)' : '';
      lines.push(`  ${i + 1}. ${p.details} [${p.condition}]${status}`);
    });
  }

  if (req.active?.[0]?.moves && !req.forceSwitch) {
    lines.push('\nMoves:');
    req.active[0].moves.forEach((m: any, i: number) => {
      const disabled = m.disabled ? ' [DISABLED]' : '';
      lines.push(`  ${i + 1}. ${m.move} (${m.type || '?'}) [${m.pp}/${m.maxpp}pp]${disabled}`);
    });
  }

  if (req.side?.pokemon) {
    const switchable = req.side.pokemon
      .map((p: any, i: number) => ({ ...p, slot: i + 1 }))
      .filter((p: any) => !p.active && p.condition !== '0 fnt');
    if (switchable.length > 0) {
      lines.push('\nSwitch:');
      switchable.forEach((p: any) => {
        lines.push(`  switch ${p.slot}. ${p.details} [${p.condition}]`);
      });
    }
  }

  return lines.join('\n');
}

export async function createBattle(matchId: string): Promise<{ p1View: string; p2View: string }> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());

  streams.omniscient.write('>start {"formatid":"gen9randombattle@@@maxTeamSize=3"}');
  streams.omniscient.write('>player p1 {"name":"Player 1"}');
  streams.omniscient.write('>player p2 {"name":"Player 2"}');

  const [p1Raw, p2Raw] = await Promise.all([drainStream(streams.p1, 2000), drainStream(streams.p2, 2000)]);

  const battle: BattleInstance = {
    streams,
    p1Request: parseRequest(p1Raw),
    p2Request: parseRequest(p2Raw),
    winner: null,
    turn: 1,
    log: [parseBattleLog(p1Raw)],
  };
  battles.set(matchId, battle);

  return {
    p1View: formatView(battle.p1Request),
    p2View: formatView(battle.p2Request),
  };
}

export async function playTurn(matchId: string, p1Move: string, p2Move: string): Promise<{
  valid: boolean;
  p1View: string;
  p2View: string;
  battleLog: string;
  winner: string | null;
  turn: number;
  error?: string;
}> {
  const battle = battles.get(matchId);
  if (!battle) return { valid: false, p1View: '', p2View: '', battleLog: '', winner: null, turn: 0, error: 'Battle expired' };

  // Write both moves simultaneously
  battle.streams.p1.write(p1Move);
  battle.streams.p2.write(p2Move);

  // Wait for turn to resolve
  await new Promise(r => setTimeout(r, 200));

  // Read both streams
  const [p1Raw, p2Raw] = await Promise.all([drainStream(battle.streams.p1, 2000), drainStream(battle.streams.p2, 2000)]);
  const combinedRaw = `${p1Raw}\n${p2Raw}`;

  const error = parseError(combinedRaw);
  if (error) {
    return {
      valid: false,
      p1View: formatView(battle.p1Request),
      p2View: formatView(battle.p2Request),
      battleLog: '',
      winner: battle.winner,
      turn: battle.turn,
      error,
    };
  }

  const newP1Req = parseRequest(p1Raw);
  const newP2Req = parseRequest(p2Raw);
  if (newP1Req) battle.p1Request = newP1Req;
  if (newP2Req) battle.p2Request = newP2Req;

  const winner = parseWinner(p1Raw) || parseWinner(p2Raw);
  if (winner) battle.winner = winner;

  const log = parseBattleLog(combinedRaw);
  const nextTurn = parseTurn(combinedRaw);
  const progressed = Boolean(log) || Boolean(winner) || nextTurn !== null;
  if (!progressed) {
    return {
      valid: false,
      p1View: formatView(battle.p1Request),
      p2View: formatView(battle.p2Request),
      battleLog: '',
      winner: battle.winner,
      turn: battle.turn,
      error: 'No battle progress for this action. If your active Pokemon fainted, you must switch.',
    };
  }

  if (nextTurn !== null) {
    battle.turn = nextTurn;
  } else if (winner) {
    battle.turn = Math.max(1, battle.turn);
  } else {
    battle.turn++;
  }
  battle.log.push(log);

  return {
    valid: true,
    p1View: formatView(battle.p1Request),
    p2View: formatView(battle.p2Request),
    battleLog: log,
    winner: battle.winner,
    turn: battle.turn,
  };
}

export function getBattleState(matchId: string) {
  return battles.get(matchId) || null;
}

export function destroyBattle(matchId: string) {
  battles.delete(matchId);
}

export const pokemon: GameEngine = {
  id: 'pokemon',
  name: 'Pokemon Battle',
  initialState: () => '{}',
  validateMove: (_s, _m, _p) => ({ valid: true, newState: _s }),
  isGameOver: (state) => {
    try { const s = JSON.parse(state); if (s.winner) return { over: true, winner: s.winner === 'Player 1' ? 1 : 2, reason: 'all_fainted' }; } catch {}
    return { over: false };
  },
  formatBoard: (state) => {
    try { const s = JSON.parse(state); return `Turn ${s.turn || 1}${s.winner ? ` - Winner: ${s.winner}` : ''}`; } catch { return 'Pokemon Battle'; }
  },
};
