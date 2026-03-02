import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

router.get('/', (_req, res) => {
  const games = db.prepare('SELECT * FROM games WHERE enabled = 1').all();
  res.json({ games });
});

router.get('/:gameId', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ? AND enabled = 1').get(req.params.gameId);
  if (!game) { res.status(404).json({ error: 'Game not found' }); return; }
  res.json(game);
});

export default router;
