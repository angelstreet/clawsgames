import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

router.get('/', (_req, res) => {
  const games = db.prepare('SELECT * FROM games WHERE enabled = 1').all();
  res.json({ games });
});


router.get('/stats', (_req, res) => {
  const stats = db.prepare(`
    SELECT g.id, g.name,
      COUNT(CASE WHEN m.status = 'completed' THEN 1 END) as total_played,
      COUNT(CASE WHEN m.status = 'active' THEN 1 END) as live_count
    FROM games g
    LEFT JOIN matches m ON m.game_id = g.id
    WHERE g.enabled = 1
    GROUP BY g.id
  `).all();
  res.json({ stats });
});

router.get('/:gameId', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ? AND enabled = 1').get(req.params.gameId as string);
  if (!game) { res.status(404).json({ error: 'Game not found' }); return; }
  res.json(game);
});

export default router;
