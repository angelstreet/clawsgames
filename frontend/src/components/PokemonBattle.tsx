import { apiUrl } from '../lib/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

interface Pokemon {
  name: string;
  details: string;
  hp: string | number;
  active: boolean;
  condition?: string;
}

interface BattleState {
  turn: number;
  winner: string | null;
  p1_pokemon: Pokemon[];
  p2_pokemon: Pokemon[];
}

interface Move {
  move_data: string;
  board_state?: string;
  move_number: number;
  agent_id?: number;
}

interface MatchData {
  id: string;
  game_id: string;
  status: string;
  result?: string;
  winner_id?: number | null;
  player1_id?: number;
  player2_id?: number;
  started_at?: string;
  finished_at?: string | null;
  p1_name: string;
  p2_name: string;
  battle: BattleState | null;
  moves: Move[];
}

interface TurnLog {
  turn: number;
  playerMove?: string;
  aiMove?: string;
  events: string[];
}

// Parse "Raging Bolt, L78, M" → { name: "Raging Bolt", level: 78 }
function parsePokemon(details: string | undefined): { name: string; level: number } {
  if (!details) return { name: 'Unknown', level: 0 };
  const parts = details.split(',');
  const name = parts[0].trim();
  const levelPart = parts.find(p => p.trim().startsWith('L'));
  const level = levelPart ? parseInt(levelPart.trim().slice(1)) : 100;
  return { name, level };
}

// "Raging Bolt" → "ragingbolt"
function toSpriteName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-/g, '');
}

function getSpriteUrl(details: string, back = false): string {
  const { name } = parsePokemon(details);
  const spriteName = toSpriteName(name);
  const dir = back ? 'gen5-back' : 'gen5';
  return `https://play.pokemonshowdown.com/sprites/${dir}/${spriteName}.gif`;
}

function toMs(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatDuration(startedAt?: string, finishedAt?: string | null): string {
  const start = toMs(startedAt);
  if (!start) return '-';
  const end = toMs(finishedAt) ?? Date.now();
  const diff = Math.max(0, end - start);
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function readableEvent(line: string, p1: string, p2: string): string {
  return line
    .replace(/^move p1a:\s*/i, `${p1}: `)
    .replace(/^move p2a:\s*/i, `${p2}: `)
    .replace(/^switch p1a:\s*/i, `${p1}: switched to `)
    .replace(/^switch p2a:\s*/i, `${p2}: switched to `)
    .replace(/^faint p1a:\s*/i, `${p1}: fainted `)
    .replace(/^faint p2a:\s*/i, `${p2}: fainted `)
    .replace(/^win\s+/i, 'Winner: ')
    .trim();
}

// Parse HP: "281/281" or "0 fnt" or just number
function parseHp(condition: string | number | undefined): { current: number; max: number; fainted: boolean } {
  if (!condition) return { current: 100, max: 100, fainted: false };
  const s = String(condition);
  if (s.includes('fnt') || s === '0') return { current: 0, max: 100, fainted: true };
  const match = s.match(/(\d+)\/(\d+)/);
  if (match) return { current: parseInt(match[1]), max: parseInt(match[2]), fainted: false };
  return { current: 100, max: 100, fainted: false };
}

function hpPercent(condition: string | number | undefined): number {
  const { current, max } = parseHp(condition);
  return max ? Math.round((current / max) * 100) : 0;
}

function hpColor(pct: number): string {
  if (pct > 50) return 'bg-green-500';
  if (pct > 20) return 'bg-yellow-400';
  return 'bg-red-500';
}

function HpBar({ condition, small = false }: { condition: string | number | undefined; small?: boolean }) {
  const pct = hpPercent(condition);
  const { fainted } = parseHp(condition);
  const colorClass = fainted ? 'bg-gray-600' : hpColor(pct);
  const h = small ? 'h-1.5' : 'h-3';
  return (
    <div className={`w-full bg-gray-700 rounded-full ${h} overflow-hidden`}>
      <div
        className={`${h} rounded-full transition-all duration-500 ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function PokemonCard({ pokemon, back = false, isActive = false }: { pokemon: Pokemon; back?: boolean; isActive?: boolean }) {
  const { name, level } = parsePokemon(pokemon.details);
  const { fainted } = parseHp(pokemon.condition || pokemon.hp);
  const pct = hpPercent(pokemon.condition || pokemon.hp);

  return (
    <div className={`flex flex-col items-center gap-1 ${!isActive ? 'opacity-50' : ''}`}>
      {/* Sprite */}
      <div className="relative w-28 h-28 sm:w-36 sm:h-36 flex items-end justify-center rounded-full bg-gradient-to-b from-slate-700/30 to-slate-900/30 ring-1 ring-white/10">
        <img
          src={getSpriteUrl(pokemon.details, back)}
          alt={name}
          className={`max-w-full max-h-full object-contain pixelated drop-shadow-[0_6px_8px_rgba(0,0,0,0.7)] ${fainted ? 'grayscale opacity-40' : ''} ${back ? '' : 'scale-x-[-1]'}`}
          style={{ imageRendering: 'pixelated' }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://play.pokemonshowdown.com/sprites/gen5/${toSpriteName(name)}.png`;
          }}
        />
        {fainted && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-red-400 font-bold text-xs bg-black/60 px-1 rounded">FNT</span>
          </div>
        )}
      </div>
      {/* Name + Level */}
      <div className="text-center">
        <div className="font-bold text-white text-sm sm:text-base">{name}</div>
        <div className="text-gray-400 text-xs">Lv.{level}</div>
      </div>
      {/* HP */}
      <div className="w-28 sm:w-36">
        <HpBar condition={pokemon.condition || pokemon.hp} />
        <div className="text-xs text-gray-400 mt-0.5 text-right">{pct}% HP</div>
      </div>
    </div>
  );
}

function TeamSidebar({ label, pokemons, isP2 = false }: { label: string; pokemons: Pokemon[]; isP2?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 ${isP2 ? 'items-end text-right' : 'items-start text-left'}`}>
      <div className="text-xs font-bold text-electric-300 text-yellow-300 uppercase tracking-wide mb-1">{label}</div>
      {pokemons?.map((p, i) => {
        const { name } = parsePokemon(p.details);
        const { fainted } = parseHp(p.condition || p.hp);
        const pct = hpPercent(p.condition || p.hp);
        return (
          <div key={i} className={`flex items-center gap-2 ${isP2 ? 'flex-row-reverse' : ''} ${fainted ? 'opacity-40' : ''}`}>
            <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-xs">
              {fainted ? '💀' : p.active ? '⚡' : '●'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white font-medium truncate max-w-[90px]">{name}</div>
              <HpBar condition={p.condition || p.hp} small />
              <div className="text-xs text-gray-500">{pct}%</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PokemonBattle() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const handleBack = () => {
    const idx = window.history.state?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
      return;
    }
    navigate('/', { replace: true });
  };

  useEffect(() => {
    if (!matchId) return;
    const load = () =>
      fetch(apiUrl(`/api/pokemon/${matchId}`))
        .then(r => r.json())
        .then(d => { setMatch(d); setLoading(false); });
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [matchId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [match?.moves]);

  const safeMoves = match?.moves || [];
  const safeP1Name = match?.p1_name || 'Player 1';
  const safeP2Name = match?.p2_name || 'Player 2';
  const safeP1Id = match?.player1_id;
  const safeP2Id = match?.player2_id;

  const turnLogs = useMemo(() => {
    const byTurn = new Map<number, TurnLog>();
    for (const move of safeMoves) {
      if (!byTurn.has(move.move_number)) {
        byTurn.set(move.move_number, { turn: move.move_number, events: [] });
      }
      const t = byTurn.get(move.move_number)!;
      if (move.agent_id === safeP1Id) t.playerMove = move.move_data;
      if (move.agent_id === safeP2Id) t.aiMove = move.move_data;

      const rawLines = String(move.board_state || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => !/^turn\s+\d+$/i.test(l));

      for (const line of rawLines) {
        const event = readableEvent(line, safeP1Name, safeP2Name);
        if (event && !t.events.includes(event)) {
          t.events.push(event);
        }
      }
    }
    return Array.from(byTurn.values()).sort((a, b) => a.turn - b.turn);
  }, [safeMoves, safeP1Id, safeP2Id, safeP1Name, safeP2Name]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-yellow-400">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-bounce">⚡</div>
        <div className="font-bold">Loading Battle...</div>
      </div>
    </div>
  );

  if (!match) return <p className="text-red-400">Match not found.</p>;

  const p1Active = match.battle?.p1_pokemon?.find(p => p.active);
  const p2Active = match.battle?.p2_pokemon?.find(p => p.active);
  const battleOver = match.status === 'completed' || match.battle?.winner;
  const duration = formatDuration(match.started_at, match.finished_at);
  const winnerName =
    match.winner_id === match.player1_id
      ? match.p1_name
      : match.winner_id === match.player2_id
        ? match.p2_name
        : (match.battle?.winner === 'Player 1' ? match.p1_name : match.battle?.winner === 'Player 2' ? match.p2_name : null);

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleBack}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <div className="text-center">
          <div className="text-lg font-bold text-yellow-400">
            {match.p1_name} <span className="text-gray-500">vs</span> {match.p2_name}
          </div>
          <div className="text-xs text-gray-500">
            Turn {match.battle?.turn ?? '?'} · {match.status === 'active' ? '🔴 LIVE' : '✅ Ended'}
          </div>
        </div>
        <div className="text-sm text-gray-600 text-right">#{matchId?.slice(0, 8)}</div>
      </div>

      {/* Winner Banner */}
      {battleOver && (match.battle?.winner || match.status === 'completed') && (
        <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-3 mb-4">
          <div className="text-yellow-300 font-bold text-lg text-center">
            {winnerName ? `Winner: ${winnerName}` : 'Battle Ended'}
          </div>
          <div className="text-xs text-yellow-100/80 mt-1 text-center">
            {match.result === 'draw' ? 'Draw' : match.result === 'timeout' ? 'Win by timeout' : 'Completed'} · Duration {duration}
          </div>
        </div>
      )}

      {/* Battle Arena */}
      {match.battle ? (
        <div className="bg-gradient-to-b from-blue-950 to-gray-950 rounded-xl border border-blue-900/40 p-4 mb-4">
          {/* Main battle layout */}
          <div className="flex gap-4 items-start">
            {/* P1 team sidebar */}
            <div className="hidden sm:block w-28 shrink-0">
              <TeamSidebar label={match.p1_name} pokemons={match.battle.p1_pokemon} />
            </div>

            {/* Battle field */}
            <div className="flex-1">
              {/* Pokemon sprites - stack on mobile, side by side on desktop */}
              <div className="flex flex-col sm:flex-row items-center justify-around gap-6 py-4">
                {/* P1 Pokemon */}
                <div className="order-2 sm:order-1">
                  {p1Active && <PokemonCard pokemon={p1Active} back={false} isActive />}
                </div>

                {/* VS divider */}
                <div className="order-1 sm:order-2 text-2xl font-black text-yellow-500/60 shrink-0">VS</div>

                {/* P2 Pokemon */}
                <div className="order-3">
                  {p2Active && <PokemonCard pokemon={p2Active} back={true} isActive />}
                </div>
              </div>

              {/* Mobile team displays */}
              <div className="flex sm:hidden justify-between gap-2 mt-3 px-2">
                <TeamSidebar label={match.p1_name} pokemons={match.battle.p1_pokemon} />
                <TeamSidebar label={match.p2_name} pokemons={match.battle.p2_pokemon} isP2 />
              </div>
            </div>

            {/* P2 team sidebar */}
            <div className="hidden sm:block w-28 shrink-0">
              <TeamSidebar label={match.p2_name} pokemons={match.battle.p2_pokemon} isP2 />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 mb-4 text-center">
          {match.status === 'completed' ? (
            <>
              <div className="text-yellow-300 font-semibold">
                {winnerName ? `Winner: ${winnerName}` : 'Battle completed'}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {match.result === 'draw' ? 'Draw' : match.result === 'timeout' ? 'Win by timeout' : 'Completed'} · Duration {duration}
              </div>
            </>
          ) : (
            <div className="text-gray-500">Battle state is temporarily unavailable</div>
          )}
        </div>
      )}

      {/* Move Log */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <div className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-2">Battle Log</div>
        <div
          ref={logRef}
          className="h-56 overflow-y-auto font-mono text-xs space-y-3 text-gray-300"
        >
          {turnLogs.length > 0 ? (
            turnLogs.map((t) => (
              <div key={t.turn} className="border border-gray-800 rounded-md p-2.5 bg-gray-950/60">
                <div className="text-yellow-300 font-semibold mb-1">Turn {t.turn}</div>
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <span className="text-gray-600">-</span>
                    <span><span className="text-blue-300">{match.p1_name}</span> {t.playerMove || '...'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-600">-</span>
                    <span><span className="text-purple-300">{match.p2_name}</span> {t.aiMove || '...'}</span>
                  </div>
                  {t.events.map((e, i) => (
                    <div key={i} className="flex gap-2 pl-3">
                      <span className="text-gray-700">•</span>
                      <span className="text-gray-400">{e}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-gray-600 italic">No turns yet...</div>
          )}
        </div>
      </div>

      {/* Status note */}
      {match.status === 'active' && (
        <div className="text-center text-xs text-gray-600">Auto-refreshing every 3s</div>
      )}
    </div>
  );
}
