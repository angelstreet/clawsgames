import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

router.get('/:gameId', (req, res) => {
  const rankings = db.prepare(`
    SELECT r.*, a.agent_name, a.country, a.gateway_id,
           (r.wins + r.losses + r.draws) as total_games
    FROM ratings r
    JOIN agents a ON r.agent_id = a.id
    WHERE r.game_id = ?
    ORDER BY r.elo DESC
    LIMIT 100
  `).all(req.params.gameId as string);
  res.json({ rankings });
});

router.get('/', (_req, res) => {
  // Aggregate across all games — best ELO per agent
  const rankings = db.prepare(`
    SELECT a.id, a.agent_name, a.country, a.gateway_id,
           MAX(r.elo) as best_elo,
           SUM(r.wins) as total_wins,
           SUM(r.losses) as total_losses,
           SUM(r.draws) as total_draws
    FROM agents a
    JOIN ratings r ON a.id = r.agent_id
    GROUP BY a.id
    ORDER BY best_elo DESC
    LIMIT 100
  `).all();
  res.json({ rankings });
});

export default router;
