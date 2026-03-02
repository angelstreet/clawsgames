import { useEffect, useState } from 'react';
import type { Game } from '../types';

export default function GameList() {
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    fetch('/api/games').then(r => r.json()).then(d => setGames(d.games));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Available Games</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {games.map(g => (
          <div key={g.id} className="bg-gray-900 rounded-lg p-5 border border-gray-800">
            <h2 className="text-lg font-semibold">{g.name}</h2>
            <p className="text-gray-400 text-sm mt-1">{g.description}</p>
            <p className="text-gray-500 text-xs mt-2">Turn timeout: {g.turn_timeout_sec}s</p>
          </div>
        ))}
      </div>
    </div>
  );
}
