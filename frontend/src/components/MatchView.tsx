import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Match } from '../types';

export default function MatchView() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<Match | null>(null);

  useEffect(() => {
    if (!matchId) return;
    fetch(`/api/matches/${matchId}`).then(r => r.json()).then(setMatch);
  }, [matchId]);

  if (!match) return <p className="text-gray-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{match.player1_name} vs {match.player2_name}</h1>
      <p className="text-sm text-gray-400 mb-4">
        Status: {match.status} | Moves: {match.move_count}
        {match.result && ` | Result: ${match.result}`}
      </p>
      <pre className="bg-gray-900 p-4 rounded-lg font-mono text-sm border border-gray-800 whitespace-pre">
        {match.board_display}
      </pre>
    </div>
  );
}
