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

interface StreamEvent {
  type: string;
  move_number?: number;
  move_data?: string;
  raw_battle_log?: string;
  status?: string;
  result?: string;
  winner_id?: number;
  message?: string;
}

export default function LiveBattle() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [turn, setTurn] = useState(0);
  const eventSource = useRef<EventSource | null>(null);
  const initialized = useRef(false);
  const battleRef = useRef<any>(null);

  useEffect(() => {
    if (!matchId || initialized.current) return;
    
    // Fetch initial match data
    fetch(`/api/pokemon/${matchId}`)
      .then(res => res.json())
      .then(data => {
        // If game is already completed, redirect to replay
        if (data.status === 'completed') {
          navigate(`/match/${matchId}`, { replace: true });
          return;
        }
        setMatch(data);
        setTurn(data.move_count || 0);
        initialized.current = true;
        setLoading(false);
        
        // Connect to SSE stream
        const eventSrc = new EventSource(`/api/pokemon/${matchId}/stream`);
        eventSource.current = eventSrc;
        
        eventSrc.onopen = () => {
          setConnected(true);
        };
        
        eventSrc.onmessage = (event) => {
          try {
            const data: StreamEvent = JSON.parse(event.data);
            handleStreamEvent(data);
          } catch (e) {
            console.error('Failed to parse SSE message:', e);
          }
        };
        
        eventSrc.onerror = () => {
          setConnected(false);
          eventSrc.close();
        };
      })
      .catch(err => {
        console.error('Failed to load match:', err);
        setError(err.message);
        setLoading(false);
      });
      
    return () => {
      if (eventSource.current) {
        eventSource.current.close();
      }
    };
  }, [matchId]);

  const handleStreamEvent = (data: StreamEvent) => {
    switch (data.type) {
      case 'connected':
        console.log('SSE Connected:', data);
        break;
        
      case 'move':
        // Update turn counter
        if (data.move_number) {
          setTurn(data.move_number);
        }
        
        // If we have raw battle log, append to the battle
        if (data.raw_battle_log && battleRef.current) {
          // For live updates, we can use the battle's add
          try {
            // @ts-ignore - Showdown battle instance
            const battle = battleRef.current;
            if (battle && battle.add) {
              const lines = data.raw_battle_log.split('\n').filter((l: string) => l.trim());
              lines.forEach((line: string) => {
                battle.add(`>${line}`);
              });
              battle.resetTurns();
            }
          } catch (e) {
            console.error('Failed to update battle:', e);
          }
        }
        break;
        
      case 'game_over':
        console.log('Game over:', data);
        if (eventSource.current) {
          eventSource.current.close();
        }
        break;
        
      case 'heartbeat':
        // Just updating the turn count
        if (data.move_number) {
          setTurn(data.move_number);
        }
        break;
        
      case 'error':
        console.error('SSE Error:', data.message);
        break;
    }
  };

  const initializeBattle = () => {
    // @ts-ignore - Showdown global
    const BattleClass = (window as any).Battle;
    if (!BattleClass) {
      console.error('Battle not loaded yet, retrying...');
      setTimeout(initializeBattle, 1000);
      return;
    }

    // Build initial battle log
    let battleLogText = '';
    
    if (match) {
      battleLogText += `|player|p1|${match.p1_name}|50|1500\n`;
      battleLogText += `|player|p2|${match.p2_name}|50|1500\n`;
      battleLogText += `|gametype|singles\n`;
      battleLogText += `|gen|9\n`;
      battleLogText += `|tier|ClawsGames Battle\n`;
      battleLogText += `|clearpoke\n`;
      
      if (match.battle) {
        const p1Team = (match as any).p1_pokemon || (match.battle as any).p1_pokemon;
        const p2Team = (match as any).p2_pokemon || (match.battle as any).p2_pokemon;
        
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
    }

    const battleContainer = document.getElementById('showdown-battle');
    const logContainer = document.getElementById('showdown-log');
    
    if (battleContainer && logContainer && BattleClass) {
      try {
        // @ts-ignore - Showdown battle
        battleRef.current = new BattleClass({
          id: matchId || 'battle',
          $frame: battleContainer,
          $logFrame: logContainer,
          log: battleLogText.split('\n'),
          isReplay: false,  // Not a replay - live battle
          paused: false,    // Don't pause - live updates
          autoresize: true
        });
      } catch (e) {
        console.error('Failed to initialize battle:', e);
      }
    }
  };

  // Initialize battle when match is loaded
  useEffect(() => {
    if (match && !loading) {
      setTimeout(initializeBattle, 500);
    }
  }, [match, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-yellow-400">Connecting to live battle...</div>
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
          onClick={() => {
            if (eventSource.current) {
              eventSource.current.close();
            }
            navigate('/');
          }}
          className="text-gray-400 hover:text-white"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <div className="text-lg font-bold">
            {match?.p1_name} vs {match?.p2_name}
          </div>
        </div>
        <div className="text-sm text-gray-400">
          Turn {turn}
        </div>
      </div>

      {/* Live indicator */}
      <div className="px-4 mb-2">
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          🔴 LIVE
        </span>
      </div>

      {/* Showdown Battle Container */}
      <div className="w-full">
        <div id="showdown-battle" className="battle"></div>
        <div id="showdown-log" className="battle-log"></div>
      </div>
    </div>
  );
}
