import { apiUrl } from '../lib/api';
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const GAME_ICONS: Record<string, string> = {
  pokemon: '⚡',
  chess: '♟',
  tictactoe: '#️⃣',
};

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface LiveMatch {
  id: string;
  game_id: string;
  move_count: number;
  started_at: string;
  player1_name: string;
  player2_name: string;
}

interface RecentMatch {
  id: string;
  game_id: string;
  result: string;
  move_count: number;
  finished_at: string;
  player1_name: string;
  player2_name: string;
  winner_id: number | null;
  player1_id: number;
  player2_id: number;
}

interface GameStat {
  id: string;
  name: string;
  total_played: number;
  live_count: number;
}

export default function SpectatorHub() {
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [gameStats, setGameStats] = useState<GameStat[]>([]);
  const [filterGame, setFilterGame] = useState<string>('');
  const navigate = useNavigate();

  const fetchData = useCallback(() => {
    const gameParam = filterGame ? `?game=${filterGame}` : '';
    fetch(apiUrl(`/api/matches/live${gameParam}`))
      .then(r => r.json()).then(d => setLiveMatches(d.matches || []));
    fetch(apiUrl(`/api/matches/recent?limit=20${filterGame ? '&game=' + filterGame : ''}`))
      .then(r => r.json()).then(d => setRecentMatches(d.matches || []));
  }, [filterGame]);

  useEffect(() => {
    fetch(apiUrl('/api/games/stats'))
      .then(r => r.json()).then(d => setGameStats(d.stats || []));
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  function getResultDisplay(match: RecentMatch) {
    if (!match.result || match.result === 'draw') return { text: 'D', color: 'text-yellow-400' };
    if (match.result === 'player1_win') return { text: 'P1 W', color: 'text-green-400' };
    if (match.result === 'player2_win') return { text: 'P2 W', color: 'text-blue-400' };
    if (match.result === 'timeout') return { text: 'TKO', color: 'text-orange-400' };
    return { text: match.result, color: 'text-gray-400' };
  }

  const totalLive = liveMatches.length;

  return (
    <div className="space-y-10">

      {/* ── SECTION 1: LIVE NOW ── */}
      <section>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <h2 className="text-lg font-bold tracking-wide uppercase text-white">
              Live Now {totalLive > 0 && <span className="text-red-400">({totalLive})</span>}
            </h2>
          </div>
          <select
            value={filterGame}
            onChange={e => setFilterGame(e.target.value)}
            className="bg-[#12121a] border border-white/10 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-white/30"
          >
            <option value="">All Games ▼</option>
            {gameStats.map(g => (
              <option key={g.id} value={g.id}>{GAME_ICONS[g.id] || '🎮'} {g.name}</option>
            ))}
          </select>
        </div>

        {liveMatches.length === 0 ? (
          <div className="flex items-center justify-center h-28 border border-white/5 rounded-xl text-gray-500 text-sm">
            No live matches right now
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
            {liveMatches.map(m => (
              <div
                key={m.id}
                className="snap-start shrink-0 w-[260px] sm:w-[280px] bg-[#12121a] border border-white/10 rounded-xl p-4 flex flex-col gap-3 hover:border-red-500/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{GAME_ICONS[m.game_id] || '🎮'}</span>
                  <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">{m.game_id}</span>
                  <span className="ml-auto w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                </div>
                <div className="text-sm font-semibold">
                  <div className="truncate text-white">{m.player1_name}</div>
                  <div className="text-gray-500 text-xs my-0.5">vs</div>
                  <div className="truncate text-white">{m.player2_name}</div>
                </div>
                <div className="text-xs text-gray-500">Move {m.move_count}</div>
                <button
                  onClick={() => navigate(`/match/${m.id}`)}
                  className="mt-auto w-full bg-red-500 hover:bg-red-400 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                >
                  👁 Watch
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── SECTION 2: RECENT MATCHES ── */}
      <section>
        <h2 className="text-lg font-bold tracking-wide uppercase text-white mb-4">Recent Matches</h2>
        {recentMatches.length === 0 ? (
          <div className="text-gray-500 text-sm">No completed matches yet</div>
        ) : (
          <div className="space-y-1">
            {recentMatches.map(m => {
              const result = getResultDisplay(m);
              return (
                <Link
                  key={m.id}
                  to={`/match/${m.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#12121a] border border-white/5 hover:border-white/20 transition-colors text-sm"
                >
                  <span className="text-base shrink-0">{GAME_ICONS[m.game_id] || '🎮'}</span>
                  <div className="flex-1 min-w-0">
                    <span className="truncate text-white font-medium">{m.player1_name}</span>
                    <span className="text-gray-500 mx-1.5">vs</span>
                    <span className="truncate text-white font-medium">{m.player2_name}</span>
                  </div>
                  <span className={`shrink-0 text-xs font-bold ${result.color}`}>{result.text}</span>
                  <span className="shrink-0 text-xs text-gray-500">{m.move_count}t</span>
                  <span className="shrink-0 text-xs text-gray-600">{m.finished_at ? timeAgo(m.finished_at) : ''}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── SECTION 3: GAMES CATALOG ── */}
      <section>
        <h2 className="text-lg font-bold tracking-wide uppercase text-white mb-4">Games</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {gameStats.map(g => (
            <button
              key={g.id}
              onClick={() => setFilterGame(filterGame === g.id ? '' : g.id)}
              className={`flex flex-col items-start p-4 rounded-xl border transition-all text-left ${
                filterGame === g.id
                  ? 'border-white/40 bg-white/10'
                  : 'border-white/10 bg-[#12121a] hover:border-white/25'
              }`}
            >
              <span className="text-2xl mb-2">{GAME_ICONS[g.id] || '🎮'}</span>
              <div className="text-sm font-semibold text-white">{g.name}</div>
              <div className="text-xs text-gray-500 mt-1">{g.total_played} played</div>
              {g.live_count > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-xs text-red-400">{g.live_count} live</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

    </div>
  );
}
