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
import db from './db/index.js';

// Cleanup stale matches (active >1 hour)
// For pokemon matches with moves, pick the HP winner; otherwise mark as timeout with no winner
function cleanupStaleMatches() {
  const stale = db.prepare(`
    SELECT id, game_id, player1_id, player2_id FROM matches
    WHERE status = 'active' AND started_at < datetime('now', '-1 hour')
  `).all() as any[];

  for (const match of stale) {
    if (match.game_id === 'pokemon') {
      // Try to pick winner from last recorded board_state HP
      const lastMove = db.prepare(
        "SELECT board_state FROM moves WHERE match_id = ? AND board_state IS NOT NULL ORDER BY id DESC LIMIT 1"
      ).get(match.id) as any;
      let winnerId: number | null = null;
      let matchResult = 'timeout';
      if (lastMove?.board_state) {
        try {
          const state = JSON.parse(lastMove.board_state);
          const p1Hp = (state.p1_pokemon || []).reduce((s: number, p: any) => {
            const m = String(p.condition || p.hp || '').match(/(\d+)\/(\d+)/);
            return s + (m ? parseInt(m[1]) / parseInt(m[2]) : 0);
          }, 0);
          const p2Hp = (state.p2_pokemon || []).reduce((s: number, p: any) => {
            const m = String(p.condition || p.hp || '').match(/(\d+)\/(\d+)/);
            return s + (m ? parseInt(m[1]) / parseInt(m[2]) : 0);
          }, 0);
          if (p1Hp > p2Hp) { winnerId = match.player1_id; matchResult = 'player1_win'; }
          else if (p2Hp > p1Hp) { winnerId = match.player2_id; matchResult = 'player2_win'; }
        } catch {}
      }
      db.prepare(`UPDATE matches SET status = 'completed', winner_id = ?, result = ?, finished_at = datetime('now') WHERE id = ?`)
        .run(winnerId, matchResult, match.id);
    } else {
      db.prepare(`UPDATE matches SET status = 'completed', result = 'timeout', finished_at = datetime('now') WHERE id = ?`)
        .run(match.id);
    }
  }

  if (stale.length > 0) {
    console.log(`🧹 Cleaned up ${stale.length} stale matches`);
  }
}

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
// Mount pokemon router at both /api/pokemon and /api/games/pokemon
app.use('/api/pokemon', pokemonRouter);
app.use('/api/games/pokemon', pokemonRouter);
app.use('/api/games', soloRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'clawsgames', port: PORT });
});

app.listen(PORT, () => {
  console.log(`🎮 ClawsGames API running on port ${PORT}`);
  
  // Clean up stale matches on startup and every 5 minutes
  cleanupStaleMatches();
  setInterval(cleanupStaleMatches, 5 * 60 * 1000);
});

export default app;
