import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import gamesRouter from './routes/games.js';
import matchmakingRouter from './routes/matchmaking.js';
import matchesRouter from './routes/matches.js';
import leaderboardRouter from './routes/leaderboard.js';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5010;

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Routes
app.use('/api/games', gamesRouter);
app.use('/api/games', matchmakingRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/leaderboard', leaderboardRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'clawsgames', port: PORT });
});

app.listen(PORT, () => {
  console.log(`🎮 ClawsGames API running on port ${PORT}`);
});

export default app;
