import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirnameRoot = dirname(fileURLToPath(import.meta.url));
try { const env = readFileSync(resolve(__dirnameRoot, "../.env"), "utf-8"); env.split("\n").forEach(l => { const [k,...v] = l.split("="); if(k && v.length) process.env[k.trim()] = v.join("=").trim(); }); } catch {}

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import gamesRouter from './routes/games.js';
import matchmakingRouter from './routes/matchmaking.js';
import matchesRouter from './routes/matches.js';
import leaderboardRouter from './routes/leaderboard.js';
import soloRouter from './routes/solo.js';
import pokemonRouter from './routes/pokemon.js';

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
app.use('/api/solo', soloRouter);
app.use('/api/games', soloRouter);
app.use('/api/pokemon', pokemonRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'clawsgames', port: PORT });
});

app.listen(PORT, () => {
  console.log(`🎮 ClawsGames API running on port ${PORT}`);
});

export default app;
