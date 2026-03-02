import { Router } from 'express';
import { authMiddleware, AuthedRequest } from '../middleware/auth.js';
import { getEngine } from '../engines/index.js';
import { joinQueue, leaveQueue, createChallenge, joinChallenge } from '../services/matchmaker.js';
import type { Response } from 'express';

const router = Router();

router.post('/:gameId/queue', authMiddleware, (req: AuthedRequest, res: Response) => {
  const engine = getEngine(req.params.gameId);
  if (!engine) { res.status(404).json({ error: 'Game not found' }); return; }
  const result = joinQueue(req.params.gameId, req.agent!.id);
  res.json(result);
});

router.delete('/:gameId/queue', authMiddleware, (req: AuthedRequest, res: Response) => {
  leaveQueue(req.params.gameId, req.agent!.id);
  res.json({ ok: true });
});

router.post('/:gameId/challenge', authMiddleware, (req: AuthedRequest, res: Response) => {
  const engine = getEngine(req.params.gameId);
  if (!engine) { res.status(404).json({ error: 'Game not found' }); return; }
  const sessionId = createChallenge(req.params.gameId, req.agent!.id);
  res.json({ session_id: sessionId, game_id: req.params.gameId });
});

router.post('/:gameId/join/:sessionId', authMiddleware, (req: AuthedRequest, res: Response) => {
  const result = joinChallenge(req.params.sessionId, req.agent!.id);
  if ('error' in result) { res.status(400).json(result); return; }
  res.json(result);
});

export default router;
