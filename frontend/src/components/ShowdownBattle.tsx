import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface Move {
  id: number;
  move_number: number;
  move_data: string;
  board_state: string;
}

interface Match {
  id: string;
  p1_name: string;
  p2_name: string;
  status: string;
  battle?: {
    turn: number;
    winner: string;
  };
}

export default function ShowdownBattle() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [loading, setLoading] = useState(true);
  const battleRef = useRef<any>(null);

  useEffect(() => {
    if (!matchId) return;
    
    fetch(`/api/pokemon/${matchId}`)
      .then(res => res.json())
      .then(data => {
        setMatch(data);
        // Collect all moves' board_state to form battle log
        const allMoves = (data.moves || []).map((m: Move) => m.board_state).join('\n');
        setMoves(data.moves || []);
        setLoading(false);
        
        // Build Showdown battle log format
        setTimeout(() => initializeBattle(data, data.moves || []), 100);
      })
      .catch(err => {
        console.error('Failed to load match:', err);
        setLoading(false);
      });
  }, [matchId]);

  const initializeBattle = (matchData: Match, movesData: Move[]) => {
    // @ts-ignore - Showdown global
    if (typeof Battle === 'undefined') {
      console.error('Battle not loaded yet');
      return;
    }

    // Build the battle log in Showdown format
    let battleLog = '';
    
    // Add player info
    battleLog += `|player|p1|${matchData.p1_name}|50|1500\n`;
    battleLog += `|player|p2|${matchData.p2_name}|50|1500\n`;
    battleLog += `|gametype|singles\n`;
    battleLog += `|gen|9\n`;
    battleLog += `|tier|ClawsGames Battle\n`;
    battleLog += `|clearpoke\n`;
    
    // Add teams (we don't have full team info, but can add what's available)
    battleLog += `|poke|p1|${matchData.p1_name}'s Team|*\n`;
    battleLog += `|poke|p2|${matchData.p2_name}'s Team|*\n`;
    battleLog += `|start\n`;

    // Add all moves
    for (const move of movesData) {
      if (move.board_state) {
        battleLog += move.board_state + '\n';
      }
    }

    // Add winner if game over
    if (matchData.status === 'completed') {
      const winner = matchData.battle?.winner || '';
      if (winner === 'Player 1') {
        battleLog += `|win|${matchData.p1_name}\n`;
      } else if (winner === 'Player 2') {
        battleLog += `|win|${matchData.p2_name}\n`;
      }
    }

    // Initialize Showdown battle
    const battleContainer = document.getElementById('showdown-battle');
    const logContainer = document.getElementById('showdown-log');
    
    if (battleContainer && logContainer) {
      // @ts-ignore
      battleRef.current = new Battle({
        id: matchId || 'battle',
        $frame: battleContainer,
        $logFrame: logContainer,
        log: battleLog.split('\n'),
        isReplay: true,
        paused: true,
        autoresize: true
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-yellow-400">Loading battle...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white"
        >
          ← Back
        </button>
        <div className="text-lg font-bold">
          {match?.p1_name} vs {match?.p2_name}
        </div>
        <button
          onClick={() => navigate(`/match/${matchId}`)}
          className="text-blue-400 hover:text-blue-300"
        >
          Classic View →
        </button>
      </div>

      {/* Showdown Battle Container */}
      <div id="showdown-battle" className="battle"></div>
      <div id="showdown-log" className="battle-log"></div>
    </div>
  );
}
