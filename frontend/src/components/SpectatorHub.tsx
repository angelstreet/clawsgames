import { apiUrl } from '../lib/api';
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const GAME_ICONS: Record<string, string> = {
  pokemon: '⚡',
  chess: '♟',
  tictactoe: '#️⃣',
};

const GAME_LABELS: Record<string, string> = {
  pokemon: 'Pokemon',
  chess: 'Chess',
  tictactoe: 'Tic-Tac-Toe',
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

interface RecentResponse {
  matches: RecentMatch[];
  page?: number;
  page_size?: number;
  window?: number;
  total?: number;
  has_more?: boolean;
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
  const [recentWindow, setRecentWindow] = useState<number>(100);
  const [recentPage, setRecentPage] = useState<number>(1);
  const [recentTotal, setRecentTotal] = useState<number>(0);
  const [agentSearchInput, setAgentSearchInput] = useState<string>('');
  const [agentSearch, setAgentSearch] = useState<string>('');
  const navigate = useNavigate();

  const fetchData = useCallback(() => {
    const gameParam = filterGame ? `?game=${filterGame}` : '';
    fetch(apiUrl(`/api/matches/live${gameParam}`))
      .then(r => r.json()).then(d => setLiveMatches(d.matches || []));
    const params = new URLSearchParams({
      window: String(recentWindow),
      page: String(recentPage),
      page_size: '100',
    });
    if (filterGame) params.set('game', filterGame);
    if (agentSearch) params.set('search', agentSearch);
    fetch(apiUrl(`/api/matches/recent?${params.toString()}`))
      .then(r => r.json())
      .then((d: RecentResponse) => {
        setRecentMatches(d.matches || []);
        setRecentTotal(d.total || 0);
      });
  }, [filterGame, recentWindow, recentPage, agentSearch]);

  useEffect(() => {
    fetch(apiUrl('/api/games/stats'))
      .then(r => r.json()).then(d => setGameStats(d.stats || []));
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    setRecentPage(1);
  }, [filterGame, recentWindow, agentSearch]);

  function getResultDisplay(match: RecentMatch) {
    // Handle timeout first — show TIMEOUT regardless of whether there's a winner_id
    if (match.result === 'timeout') {
      return { text: 'TIMEOUT', color: 'text-orange-400' };
    }

    if (!match.result || match.result === 'draw') {
      return { text: 'DRAW', color: 'text-yellow-400' };
    }

    const winnerName =
      match.winner_id === match.player1_id
        ? match.player1_name
        : match.winner_id === match.player2_id
          ? match.player2_name
          : null;

    if (winnerName) {
      return { text: `🏆 ${winnerName}`, color: 'text-green-400' };
    }

    return { text: '-', color: 'text-gray-500' };
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
            <option value="">All Games</option>
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
                <div className="mt-auto flex gap-1">
                  <button
                    onClick={() => navigate(`/live/${m.id}`)}
                    className="flex-1 bg-red-500 hover:bg-red-400 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                  >
                    🔴 Live
                  </button>
                  <button
                    onClick={() => navigate(`/match/${m.id}`)}
                    className="flex-1 bg-blue-500 hover:bg-blue-400 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                  >
                    📺 Replay
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── SECTION 2: RECENT MATCHES ── */}
      <section>
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h2 className="text-lg font-bold tracking-wide uppercase text-white">Recent Matches</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={recentWindow}
              onChange={e => setRecentWindow(parseInt(e.target.value, 10))}
              className="bg-[#12121a] border border-white/10 text-gray-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/30"
            >
              <option value={10}>Last 10</option>
              <option value={100}>Last 100</option>
              <option value={1000}>Last 1000</option>
            </select>
            <input
              type="text"
              value={agentSearchInput}
              onChange={e => setAgentSearchInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') setAgentSearch(agentSearchInput.trim());
              }}
              placeholder="Search agent"
              className="bg-[#12121a] border border-white/10 text-gray-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/30 w-[140px]"
            />
            <button
              onClick={() => setAgentSearch(agentSearchInput.trim())}
              className="bg-white/10 border border-white/10 hover:bg-white/15 text-gray-200 text-xs rounded-lg px-2.5 py-1.5 transition-colors"
            >
              Search
            </button>
            {agentSearch && (
              <button
                onClick={() => {
                  setAgentSearch('');
                  setAgentSearchInput('');
                }}
                className="bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 text-xs rounded-lg px-2.5 py-1.5 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {recentMatches.length === 0 ? (
          <div className="text-gray-500 text-sm">No completed matches yet</div>
        ) : (
          <div className="space-y-1">
            {recentMatches.map(m => {
              const result = getResultDisplay(m);
              const p1Won = m.winner_id === m.player1_id;
              const p2Won = m.winner_id === m.player2_id;
              const isDraw = !m.result || m.result === 'draw';
              return (
                <Link
                  key={m.id}
                  to={m.game_id === 'pokemon' ? `/match/${m.id}` : `/match/${m.id}`}
                  className="grid grid-cols-[96px_1fr_84px_48px_56px] items-center gap-3 px-3 py-2.5 rounded-lg bg-[#12121a] border border-white/5 hover:border-white/20 transition-colors text-sm"
                >
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-300 bg-white/10 border border-white/15 px-2 py-1 rounded-md min-w-[86px] text-center">
                    {GAME_LABELS[m.game_id] || m.game_id}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className={`font-medium ${p1Won ? 'text-green-300' : isDraw ? 'text-white' : 'text-gray-300'}`}>
                        {p1Won && <span className="mr-1">🏆</span>}
                        {m.player1_name}
                      </span>
                      <span className="text-gray-500 mx-1.5">vs</span>
                      <span className={`font-medium ${p2Won ? 'text-green-300' : isDraw ? 'text-white' : 'text-gray-300'}`}>
                        {p2Won && <span className="mr-1">🏆</span>}
                        {m.player2_name}
                      </span>
                    </div>
                  </div>
                  <span className={`shrink-0 text-xs font-bold text-center truncate max-w-[110px] ${result.color}`}>{result.text}</span>
                  <span className="shrink-0 text-xs text-gray-500 text-right">{m.move_count}t</span>
                  <span className="shrink-0 text-xs text-gray-600 text-right">{m.finished_at ? timeAgo(m.finished_at) : ''}</span>
                </Link>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between mt-3 text-xs">
          <span className="text-gray-500">
            {recentTotal > 0 ? `Showing page ${recentPage} · ${recentTotal} total` : 'No results'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRecentPage(p => Math.max(1, p - 1))}
              disabled={recentPage <= 1}
              className="px-2.5 py-1 rounded border border-white/10 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
            >
              Prev
            </button>
            <button
              onClick={() => setRecentPage(p => p + 1)}
              disabled={recentPage * 100 >= recentTotal}
              className="px-2.5 py-1 rounded border border-white/10 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
            >
              Next
            </button>
          </div>
        </div>
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
