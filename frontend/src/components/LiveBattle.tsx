import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function LiveBattle() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!matchId) return;
    
    // Redirect to MatchView which handles Pokemon with live updates
    // The MatchView component polls for updates automatically
    navigate(`/match/${matchId}`, { replace: true });
  }, [matchId, navigate]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-yellow-400">Loading live battle...</div>
    </div>
  );
}
