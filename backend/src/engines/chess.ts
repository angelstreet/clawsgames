import { Chess } from 'chess.js';
import type { GameEngine, MoveResult, GameOverResult } from './types.js';

export const chess: GameEngine = {
  id: 'chess',
  name: 'Chess',

  initialState(): string {
    return new Chess().fen();
  },

  validateMove(state: string, move: string, player: 1 | 2): MoveResult {
    const game = new Chess(state);
    const expectedColor = player === 1 ? 'w' : 'b';
    if (game.turn() !== expectedColor) {
      return { valid: false, error: 'Not your turn' };
    }
    try {
      const result = game.move(move);
      if (!result) return { valid: false, error: 'Invalid move' };
      return { valid: true, newState: game.fen() };
    } catch {
      return { valid: false, error: 'Invalid move notation. Use SAN (e.g. e4, Nf3, O-O) or UCI (e.g. e2e4).' };
    }
  },

  isGameOver(state: string): GameOverResult {
    const game = new Chess(state);
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 2 : 1;
      return { over: true, winner: winner as 1 | 2, reason: 'checkmate' };
    }
    if (game.isDraw()) {
      const reason = game.isStalemate() ? 'stalemate' :
                     game.isThreefoldRepetition() ? 'threefold_repetition' :
                     game.isInsufficientMaterial() ? 'insufficient_material' : 'fifty_move_rule';
      return { over: true, reason };
    }
    return { over: false };
  },

  formatBoard(state: string): string {
    const game = new Chess(state);
    return game.ascii();
  }
};
