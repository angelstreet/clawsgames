import { apiUrl } from '../lib/api';
import { apiUrl } from '../lib/api';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Game } from '../types';

interface PokemonMatch {
  id: string;
  status: string;
  p1_name: string;
  p2_name: string;
  move_count: number;
  started_at: string;
}

export default function GameList() {
  const [games, setGames] = useState<Game[]>([]);
  const [pokemonMatches, setPokemonMatches] = useState<PokemonMatch[]>([]);

  useEffect(() => {
    fetch(apiUrl('/api/games').then(r => r.json()).then(d => setGames(d.games));
    fetch(apiUrl('/api/pokemon/').then(r => r.json()).then(d => setPokemonMatches(d.matches || []));
  }, []);

  const activeMatches = pokemonMatches.filter(m => m.status === 'active');
  const recentMatches = pokemonMatches.slice(0, 5);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Available Games</h1>
      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        {games.map(g => (
          <div key={g.id} className={`rounded-lg p-5 border ${g.id === 'pokemon' ? 'bg-yellow-950/30 border-yellow-700/40' : 'bg-gray-900 border-gray-800'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  {g.id === 'pokemon' && <span>⚡</span>}
                  {g.name}
                </h2>
                <p className="text-gray-400 text-sm mt-1">{g.description}</p>
                <p className="text-gray-500 text-xs mt-2">Turn timeout: {g.turn_timeout_sec}s</p>
              </div>
              {g.id === 'pokemon' && activeMatches.length > 0 && (
                <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full shrink-0">
                  🔴 {activeMatches.length} LIVE
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pokemon Matches Section */}
      {pokemonMatches.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span>⚡</span> Pokemon Battles
          </h2>
          <div className="space-y-2">
            {recentMatches.map(m => (
              <div
                key={m.id}
                className={`flex items-center justify-between p-3 rounded-lg border gap-3 ${
                  m.status === 'active'
                    ? 'bg-yellow-950/20 border-yellow-700/30'
                    : 'bg-gray-900 border-gray-800'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {m.status === 'active' && (
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
                    )}
                    <span className="truncate">{m.p1_name}</span>
                    <span className="text-gray-500 shrink-0">vs</span>
                    <span className="truncate">{m.p2_name}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {m.status === 'active' ? `Turn ${m.move_count}` : `Ended · ${m.move_count} moves`}
                  </div>
                </div>
                <Link
                  to={`/match/${m.id}`}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    m.status === 'active'
                      ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {m.status === 'active' ? '👁 Watch' : 'View'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
