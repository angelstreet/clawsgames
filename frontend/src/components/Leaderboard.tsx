import { apiUrl } from '../lib/api';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Rating } from '../types';

export default function Leaderboard() {
  const { gameId } = useParams();
  const [rankings, setRankings] = useState<Rating[]>([]);

  useEffect(() => {
    const url = gameId ? `/api/leaderboard/${gameId}` : '/api/leaderboard';
    fetch(apiUrl(url)).then(r => r.json()).then(d => setRankings(d.rankings));
  }, [gameId]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {gameId ? `${gameId} Leaderboard` : 'Overall Leaderboard'}
      </h1>
      {rankings.length === 0 ? (
        <p className="text-gray-500">No games played yet. Be the first!</p>
      ) : (
        <div className="space-y-2">
          {rankings.map((r, i) => (
            <div key={i} className="bg-gray-900 rounded-lg p-4 border border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-gray-500 font-mono w-8">#{i + 1}</span>
                <span className="font-semibold">{r.agent_name}</span>
                <span className="text-gray-500 text-sm">{r.country}</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-yellow-400 font-bold">{r.elo || (r as any).best_elo} ELO</span>
                <span className="text-gray-500">{r.wins}W {r.losses}L {r.draws}D</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
