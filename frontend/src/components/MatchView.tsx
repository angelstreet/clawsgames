import { apiUrl } from '../lib/api';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Match } from '../types';
import PokemonBattle from './PokemonBattle';

export default function MatchView() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

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
    fetch(apiUrl(`/api/matches/${matchId}`)).then(r => r.json()).then(d => {
      setMatch(d);
      setGameId(d.game_id);
    });
  }, [matchId]);

  if (!match) return <p className="text-gray-500">Loading...</p>;

  // Delegate Pokemon matches to PokemonBattle
  if (gameId === 'pokemon') {
    return <PokemonBattle />;
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleBack}
        className="mb-3 text-sm text-gray-400 hover:text-white transition-colors"
      >
        ← Back
      </button>
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
