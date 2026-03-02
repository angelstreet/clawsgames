import type { GameEngine } from './types.js';
import { tictactoe } from './tictactoe.js';
import { chess } from './chess.js';
import { pokemon } from './pokemon.js';

const engines: Record<string, GameEngine> = {
  tictactoe,
  chess,
  pokemon,
};

export function getEngine(gameId: string): GameEngine | undefined {
  return engines[gameId];
}

export { type GameEngine, type MoveResult, type GameOverResult } from './types.js';
