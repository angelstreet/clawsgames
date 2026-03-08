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
  move_count?: number;
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
  // Use Showdown "home" sprites - designed to work on any background
  return `https://play.pokemonshowdown.com/sprites/home/${spriteName}.png`;
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
  let result = line
    .replace(/^move p1a:/i, `${p1} used`)
    .replace(/^move p2a:/i, `${p2} used`)
    .replace(/^switch p1a:/i, `${p1} switched to`)
    .replace(/^switch p2a:/i, `${p2} switched to`)
    .replace(/^faint p1a:/i, `${p1}'s`)
    .replace(/^faint p2a:/i, `${p2}'s`)
    .replace(/-damage\|\s*p\d[a-z]*:/gi, (match) => {
      const player = match.includes('p1') ? p1 : p2;
      return `${player}'s`;
    })
    .replace(/-heal\|\s*p\d[a-z]*:/gi, (match) => {
      const player = match.includes('p1') ? p1 : p2;
      return `${player} recovered`;
    })
    .replace(/-supereffective\|/gi, 'It\'s super effective! ')
    .replace(/-resisted\|/gi, 'It\'s not very effective... ')
    .replace(/-crit\|/gi, 'Critical hit! ')
    .replace(/-miss\|/gi, 'missed! ')
    .replace(/^win\s+/i, 'Winner: ')
    .trim();
  
  // Format damage: "p1a: Charizard 100/100" -> "Charizard took damage (100/100)"
  if (result.includes('|')) {
    const parts = result.split('|').filter(p => p.trim());
    if (parts.length >= 2) {
      // Extract Pokemon name from position
      const pokemon = parts[0].replace(/^p\d[a-z]*:/i, '').trim() || '';
      const condition = parts[parts.length - 1].trim();
      if (condition && /^\d+\/\d+$/.test(condition)) {
        result = `${pokemon} [${condition}]`;
      } else if (condition) {
        result = `${pokemon} ${condition}`;
      }
    }
  }
  
  return result;
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
      <div className="relative w-28 h-28 sm:w-36 sm:h-36 flex items-end justify-center rounded-full bg-white ring-1 ring-black/10">
        <img
          src={getSpriteUrl(pokemon.details, back)}
          alt={name}
          className={`max-w-full max-h-full object-contain pixelated ${fainted ? 'grayscale opacity-40' : ''} ${back ? '' : 'scale-x-[-1]'}`}
          style={{ imageRendering: 'pixelated', filter: 'brightness(1) contrast(1) invert(0) !important' }}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            const base = name.split('-')[0].toLowerCase();
            img.onerror = null;
            img.src = `https://play.pokemonshowdown.com/sprites/home/${base}.png`;
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
  const [lastBattle, setLastBattle] = useState<BattleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReplay, setShowReplay] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [liveLogEmpty, setLiveLogEmpty] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const battleInstanceRef = useRef<any>(null);
  const replayContainerRef = useRef<HTMLDivElement>(null);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLogRef = useRef<string>('');

  const handleBack = () => {
    const idx = window.history.state?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
      return;
    }
    navigate('/', { replace: true });
  };

  const destroyBattle = () => {
    if (battleInstanceRef.current) {
      try { battleInstanceRef.current.destroy?.(); } catch {}
      battleInstanceRef.current = null;
    }
  };

  const initBattleWithLog = (logText: string, paused: boolean, retries = 10) => {
    const BattleClass = (window as any).Battle;
    const $ = (window as any).$;
    if (!BattleClass || !$) {
      if (retries > 0) setTimeout(() => initBattleWithLog(logText, paused, retries - 1), 500);
      return;
    }
    const frame = document.getElementById('inline-battle-frame');
    const logFrame = document.getElementById('inline-battle-log');
    if (!frame || !logFrame) return;
    destroyBattle();
    try {
      battleInstanceRef.current = new BattleClass({
        id: `inline-${matchId}`,
        $frame: $(frame),
        $logFrame: $(logFrame),
        log: logText.split('\n'),
        isReplay: true,
        paused,
        autoresize: true,
      });
    } catch (e) { console.error('Failed to init battle:', e); }
  };

  const fetchAndInitBattle = async (paused: boolean) => {
    const logData = await fetch(apiUrl(`/api/pokemon/${matchId}/log`))
      .then(r => r.json())
      .catch(() => ({ log: '' }));
    const logText = logData.log || '';
    if (!logText) { setLiveLogEmpty(true); return; }
    setLiveLogEmpty(false);
    lastLogRef.current = logText;
    initBattleWithLog(logText, paused);
  };

  const stopLivePolling = () => {
    if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
  };

  const handleToggleReplay = () => {
    if (showReplay) {
      stopLivePolling();
      destroyBattle();
      setShowReplay(false);
    } else {
      setShowReplay(true);
    }
  };

  useEffect(() => {
    if (!showReplay) return;
    const isLive = match?.status === 'active';
    setTimeout(() => fetchAndInitBattle(false), 200);
    setTimeout(() => replayContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    if (isLive) {
      liveIntervalRef.current = setInterval(async () => {
        const logData = await fetch(apiUrl(`/api/pokemon/${matchId}/log`))
          .then(r => r.json()).catch(() => ({ log: '' }));
        const logText = logData.log || '';
        if (logText && logText !== lastLogRef.current) {
          lastLogRef.current = logText;
          setLiveLogEmpty(false);
          initBattleWithLog(logText, false);
        } else if (!logText) {
          setLiveLogEmpty(true);
        }
      }, 4000);
    }
    return () => stopLivePolling();
  }, [showReplay]);

  // Stop Showdown JS on unmount
  useEffect(() => {
    return () => { stopLivePolling(); destroyBattle(); };
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!matchId) return;
    const load = () =>
      fetch(apiUrl(`/api/pokemon/${matchId}`))
        .then(r => r.json())
        .then(d => {
          setMatch(d);
          if (d?.battle) setLastBattle(d.battle);
          setLoading(false);
          // Stop polling once the match is completed
          if (d?.status === 'completed' && intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        });
    load();
    intervalRef.current = setInterval(load, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [matchId]);

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
      const humanMove = (raw: string) => {
        if (/^move [1-4]$/i.test(raw)) return `Move ${raw.split(' ')[1]}`;
        if (/^[1-4]$/.test(raw)) return `Move ${raw}`;
        if (/^switch [1-6]$/i.test(raw)) return `Switch ${raw.split(' ')[1]}`;
        return raw;
      };
      if (move.agent_id === safeP1Id) t.playerMove = humanMove(move.move_data);
      if (move.agent_id === safeP2Id) t.aiMove = humanMove(move.move_data);

      const rawLines = String(move.board_state || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => !/^turn\s+\d+$/i.test(l))
        .filter(l => !/^\{/.test(l));  // skip JSON artifacts (board_state stored as {})


      for (const line of rawLines) {
        const event = readableEvent(line, safeP1Name, safeP2Name);
        if (event && !t.events.includes(event)) {
          t.events.push(event);
        }
      }
    }
    const sorted = Array.from(byTurn.values()).sort((a, b) => a.turn - b.turn);
    const compact: TurnLog[] = [];
    for (const turn of sorted) {
      const prev = compact[compact.length - 1];
      const duplicateNoEvent =
        turn.events.length === 0 &&
        prev &&
        prev.events.length === 0 &&
        prev.playerMove === turn.playerMove &&
        prev.aiMove === turn.aiMove;
      if (!duplicateNoEvent) compact.push(turn);
    }
    return compact;
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

  const displayedBattle = (match.battle?.p1_pokemon ? match.battle : null) || (match.status === 'completed' ? lastBattle : null);
  const p1Active = displayedBattle?.p1_pokemon?.find(p => p.active);
  const p2Active = displayedBattle?.p2_pokemon?.find(p => p.active);
  const battleOver = match.status === 'completed' || displayedBattle?.winner;
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
      <div className="relative flex items-center justify-center mb-4 min-h-[3rem]">
        <button
          type="button"
          onClick={handleBack}
          className="absolute left-0 text-gray-400 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <div className="text-center">
          <div className="text-lg font-bold flex items-center gap-2 justify-center">
            <span className={match.status === 'completed' && winnerName ? (winnerName === match.p1_name ? 'text-yellow-400' : 'text-gray-500') : 'text-yellow-400'}>
              {match.status === 'completed' && winnerName ? (winnerName === match.p1_name ? '🏆 ' : '💀 ') : ''}{match.p1_name}
            </span>
            <span className="text-gray-500">vs</span>
            <span className={match.status === 'completed' && winnerName ? (winnerName === match.p2_name ? 'text-yellow-400' : 'text-gray-500') : 'text-yellow-400'}>
              {match.status === 'completed' && winnerName ? (winnerName === match.p2_name ? '🏆 ' : '💀 ') : ''}{match.p2_name}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            {match.status === 'active'
              ? `Turn ${match.battle?.turn ?? match.move_count ?? '?'} · LIVE`
              : `${match.result === 'timeout' ? 'timeout' : match.result === 'draw' ? 'draw' : 'completed'} · ${duration}${match.move_count ? ` · turn ${match.move_count}` : ''}`}
          </div>
        </div>
        <div className="absolute right-0 text-sm text-gray-600">#{matchId?.slice(0, 8)}</div>
      </div>

      {/* Replay / Live button */}
      {!showReplay && (match.status === 'completed' || match.status === 'active') && (
        <div className="flex justify-center mb-4">
          <button
            onClick={handleToggleReplay}
            className={`font-semibold px-5 py-2 rounded-full text-sm transition-colors shadow-lg text-white ${match.status === 'active' ? 'bg-red-600 hover:bg-red-500' : 'bg-purple-600 hover:bg-purple-500'}`}
          >
            {match.status === 'active' ? '🔴 Watch Live' : '🎬 Watch Animated Replay'}
          </button>
        </div>
      )}

      {/* Inline Replay / Live Container */}
      {showReplay && (
        <div ref={replayContainerRef} className="relative bg-gray-900 rounded-xl border border-gray-800 mb-4" style={{ height: '420px', overflow: 'hidden' }}>
          {match?.status === 'active' && (
            <div className="absolute top-2 left-3 z-10 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
              <span className="text-xs text-red-400 font-semibold">LIVE</span>
            </div>
          )}
          {liveLogEmpty && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm z-10 pointer-events-none">
              Live battle view not available for this match
            </div>
          )}
          <div className="absolute top-2 right-2 z-10 flex gap-2">
            <button
              onClick={() => {
                const next = !isMuted;
                setIsMuted(next);
                const BS = (window as any).BattleSound;
                if (BS?.setMute) { BS.setMute(next); }
              }}
              className="bg-black/70 hover:bg-black/90 text-white text-xs px-3 py-1.5 rounded-full border border-white/20 transition-colors"
            >
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={handleToggleReplay}
              className="bg-black/70 hover:bg-black/90 text-white text-xs px-3 py-1.5 rounded-full border border-white/20 transition-colors"
            >
              Close
            </button>
          </div>
          <div id="inline-battle-frame" className="battle" style={{ width: '100%', height: '100%' }} />
          <div id="inline-battle-log" className="battle-log" />
        </div>
      )}

      {/* Battle Arena */}
      {displayedBattle ? (
        <div className="bg-gradient-to-b from-blue-950 to-gray-950 rounded-xl border border-blue-900/40 p-4 mb-4">
          {/* Active Pokemon row */}
          <div className="flex flex-col sm:flex-row items-center justify-around gap-6 py-4">
            {/* P1 active */}
            <div className="order-2 sm:order-1 flex flex-col items-center gap-3">
              {p1Active && <PokemonCard pokemon={p1Active} back={false} isActive />}
              {/* P1 bench */}
              {displayedBattle.p1_pokemon.filter(p => !p.active).length > 0 && (
                <div className="flex gap-2 justify-center">
                  {displayedBattle.p1_pokemon.filter(p => !p.active).map((p, i) => {
                    const { name } = parsePokemon(p.details);
                    const { fainted } = parseHp(p.condition || p.hp);
                    const pct = hpPercent(p.condition || p.hp);
                    return (
                      <div key={i} className="flex flex-col items-center gap-0.5">
                        <div className="relative w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                          <img
                            src={getSpriteUrl(p.details)}
                            alt={name}
                            className={`w-14 h-14 object-contain pixelated scale-x-[-1] ${fainted ? 'grayscale opacity-40' : ''}`}
                            style={{ imageRendering: 'pixelated' }}
                            onError={(e) => { const img = e.target as HTMLImageElement; img.onerror = null; img.src = `https://play.pokemonshowdown.com/sprites/home/${name.split('-')[0].toLowerCase()}.png`; }}
                          />
                          {fainted && <span className="absolute bottom-0 right-0 text-[8px] bg-red-700 text-white rounded px-0.5 leading-tight">FNT</span>}
                        </div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[56px] text-center">{name}</div>
                        {!fainted && <div className="text-[9px] text-green-400">{pct}%</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* VS divider */}
            <div className="order-1 sm:order-2 shrink-0 flex items-center gap-2">
              {match.status === 'completed' && winnerName && (
                <span className={`text-[11px] font-bold ${winnerName === match.p1_name ? 'text-yellow-400' : 'text-gray-500'}`}>
                  {winnerName === match.p1_name ? '🏆' : '💀'} {match.p1_name}
                </span>
              )}
              <div className="text-2xl font-black text-yellow-500/60">VS</div>
              {match.status === 'completed' && winnerName && (
                <span className={`text-[11px] font-bold ${winnerName === match.p2_name ? 'text-yellow-400' : 'text-gray-500'}`}>
                  {winnerName === match.p2_name ? '🏆' : '💀'} {match.p2_name}
                </span>
              )}
            </div>

            {/* P2 active */}
            <div className="order-3 flex flex-col items-center gap-3">
              {p2Active && <PokemonCard pokemon={p2Active} back={true} isActive />}
              {/* P2 bench */}
              {displayedBattle.p2_pokemon.filter(p => !p.active).length > 0 && (
                <div className="flex gap-2 justify-center">
                  {displayedBattle.p2_pokemon.filter(p => !p.active).map((p, i) => {
                    const { name } = parsePokemon(p.details);
                    const { fainted } = parseHp(p.condition || p.hp);
                    const pct = hpPercent(p.condition || p.hp);
                    return (
                      <div key={i} className="flex flex-col items-center gap-0.5">
                        <div className="relative w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                          <img
                            src={getSpriteUrl(p.details)}
                            alt={name}
                            className={`w-14 h-14 object-contain pixelated ${fainted ? 'grayscale opacity-40' : ''}`}
                            style={{ imageRendering: 'pixelated' }}
                            onError={(e) => { const img = e.target as HTMLImageElement; img.onerror = null; img.src = `https://play.pokemonshowdown.com/sprites/home/${name.split('-')[0].toLowerCase()}.png`; }}
                          />
                          {fainted && <span className="absolute bottom-0 right-0 text-[8px] bg-red-700 text-white rounded px-0.5 leading-tight">FNT</span>}
                        </div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[56px] text-center">{name}</div>
                        {!fainted && <div className="text-[9px] text-green-400">{pct}%</div>}
                      </div>
                    );
                  })}
                </div>
              )}
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
                {match.result === 'draw' ? 'Draw' : match.result === 'timeout' ? (winnerName ? 'Win by timeout' : 'Timeout') : 'Completed'} · Duration {duration}
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
          className="font-mono text-xs space-y-2 text-gray-300"
        >
          {turnLogs.length > 0 ? (
            turnLogs.map((t) => (
              <div key={t.turn} className="border border-gray-700 rounded-md p-3 bg-gray-900/80">
                <div className="text-yellow-400 font-bold mb-2 flex items-center gap-2">
                  <span className="bg-yellow-500/20 px-2 py-0.5 rounded text-yellow-300">Turn {t.turn}</span>
                </div>
                <div className="space-y-1.5">
                  {/* Player moves */}
                  {t.playerMove && (
                    <div className="flex gap-2">
                      <span className="text-green-400">→</span>
                      <span><span className="text-blue-400 font-medium">{match.p1_name}</span> used <span className="text-white">{t.playerMove}</span></span>
                    </div>
                  )}
                  {t.aiMove && (
                    <div className="flex gap-2">
                      <span className="text-green-400">→</span>
                      <span><span className="text-purple-400 font-medium">{match.p2_name}</span> used <span className="text-white">{t.aiMove}</span></span>
                    </div>
                  )}
                  {/* Battle events */}
                  {t.events.map((e, i) => {
                    // Style based on event type
                    let eventClass = 'text-gray-400';
                    let prefix = '•';
                    if (e.toLowerCase().includes('fainted')) {
                      eventClass = 'text-red-400 font-bold';
                      prefix = '💀';
                    } else if (e.toLowerCase().includes('super effective')) {
                      eventClass = 'text-yellow-400 font-bold';
                      prefix = '✨';
                    } else if (e.toLowerCase().includes('not very effective')) {
                      eventClass = 'text-blue-300';
                      prefix = '💧';
                    } else if (e.toLowerCase().includes('critical')) {
                      eventClass = 'text-orange-400 font-bold';
                      prefix = '⚡';
                    } else if (e.toLowerCase().includes('missed')) {
                      eventClass = 'text-gray-500';
                      prefix = '❌';
                    } else if (e.toLowerCase().includes('recovered')) {
                      eventClass = 'text-green-400';
                      prefix = '💚';
                    } else if (e.includes('[') && e.match(/\d+\/\d+/)) {
                      eventClass = 'text-amber-300';
                      prefix = '📊';
                    }
                    
                    return (
                      <div key={i} className={`flex gap-2 pl-2 ${eventClass}`}>
                        <span className="opacity-70">{prefix}</span>
                        <span>{e}</span>
                      </div>
                    );
                  })}
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
