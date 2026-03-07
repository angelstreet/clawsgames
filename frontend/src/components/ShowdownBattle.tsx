import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface Match {
  id: string;
  p1_name: string;
  p2_name: string;
  status: string;
  p1_pokemon?: any[];
  p2_pokemon?: any[];
  battle?: {
    turn: number;
    winner: string;
  };
}

export default function ShowdownBattle() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [battleLog, setBattleLog] = useState<string>('');
  const initialized = useRef(false);

  useEffect(() => {
    if (!matchId || initialized.current) return;
    
    // Fetch both match data and raw battle log in parallel
    Promise.all([
      fetch(`/api/pokemon/${matchId}`).then(res => res.json()),
      fetch(`/api/pokemon/${matchId}/log`).then(res => res.json()).catch(() => ({ log: '' }))
    ])
      .then(([matchData, logData]) => {
        setMatch(matchData);
        setBattleLog(logData.log || '');
        initialized.current = true;
        setLoading(false);
        
        // Initialize after a short delay to ensure Battle.js is loaded
        setTimeout(() => initializeBattle(matchData, logData.log || ''), 500);
      })
      .catch(err => {
        console.error('Failed to load match:', err);
        setError(err.message);
        setLoading(false);
      });
  }, [matchId]);

  const initializeBattle = (matchData: Match, rawLog: string) => {
    // @ts-ignore - Showdown global
    const BattleClass = (window as any).Battle;
    if (!BattleClass) {
      console.error('Battle not loaded yet, retrying...');
      setTimeout(() => initializeBattle(matchData, rawLog), 1000);
      return;
    }

    let battleLogText = '';
    
    // If we have raw log from API, use it directly
    if (rawLog) {
      battleLogText = rawLog;
    } else {
      // Fallback: build manually from match data (for backwards compatibility)
      // Add player info
      battleLogText += `|player|p1|${matchData.p1_name}|50|1500\n`;
      battleLogText += `|player|p2|${matchData.p2_name}|50|1500\n`;
      battleLogText += `|gametype|singles\n`;
      battleLogText += `|gen|9\n`;
      battleLogText += `|tier|ClawsGames Battle\n`;
      battleLogText += `|clearpoke\n`;
      
      // Add teams from the battle state if available
      if (matchData.battle) {
        const p1Team = (matchData as any).p1_pokemon || (matchData.battle as any).p1_pokemon;
        const p2Team = (matchData as any).p2_pokemon || (matchData.battle as any).p2_pokemon;
        
        if (p1Team) {
          p1Team.forEach((p: any) => {
            battleLogText += `|poke|p1|${p.details}|${p.item || ''}\n`;
          });
        }
        if (p2Team) {
          p2Team.forEach((p: any) => {
            battleLogText += `|poke|p2|${p.details}|${p.item || ''}\n`;
          });
        }
      }
      
      battleLogText += `|start\n`;

      // Add all moves from the moves array
      const movesData = (matchData as any).moves || [];
      for (const move of movesData) {
        if (move.board_state) {
          battleLogText += move.board_state + '\n';
        }
      }

      // Add winner if game over
      if (matchData.status === 'completed') {
        const winner = matchData.battle?.winner || '';
        if (winner === 'Player 1') {
          battleLogText += `|win|${matchData.p1_name}\n`;
        } else if (winner === 'Player 2') {
          battleLogText += `|win|${matchData.p2_name}\n`;
        }
      }
    }

    // Initialize Showdown battle
    const battleContainer = document.getElementById('showdown-battle');
    const logContainer = document.getElementById('showdown-log');
    
    if (battleContainer && logContainer && BattleClass) {
      try {
        new BattleClass({
          id: matchId || 'battle',
          $frame: battleContainer,
          $logFrame: logContainer,
          log: battleLogText.split('\n'),
          isReplay: true,
          paused: true,
          autoresize: true
        });
      } catch (e) {
        console.error('Failed to initialize battle:', e);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-yellow-400">Loading battle...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="text-red-400">Error: {error}</div>
        <button onClick={() => navigate('/')} className="mt-4 text-blue-400">← Back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 px-4">
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
      <div className="w-full">
        <div id="showdown-battle" className="battle"></div>
        <div id="showdown-log" className="battle-log"></div>
      </div>
    </div>
  );
}
