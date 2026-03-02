import type { GameEngine, MoveResult, GameOverResult } from './types.js';

// Board: ".........", 9 chars, '.' = empty, 'X' = player1, 'O' = player2
// Positions 0-8 (top-left to bottom-right)

const WINS = [
  [0,1,2],[3,4,5],[6,7,8], // rows
  [0,3,6],[1,4,7],[2,5,8], // cols
  [0,4,8],[2,4,6]          // diags
];

export const tictactoe: GameEngine = {
  id: 'tictactoe',
  name: 'Tic-Tac-Toe',

  initialState(): string {
    return '.........';
  },

  validateMove(state: string, move: string, player: 1 | 2): MoveResult {
    const pos = parseInt(move, 10);
    if (isNaN(pos) || pos < 0 || pos > 8) {
      return { valid: false, error: 'Move must be 0-8' };
    }
    if (state[pos] !== '.') {
      return { valid: false, error: `Position ${pos} is already taken` };
    }
    const mark = player === 1 ? 'X' : 'O';
    const newState = state.substring(0, pos) + mark + state.substring(pos + 1);
    return { valid: true, newState };
  },

  isGameOver(state: string): GameOverResult {
    for (const [a, b, c] of WINS) {
      if (state[a] !== '.' && state[a] === state[b] && state[b] === state[c]) {
        const winner = state[a] === 'X' ? 1 : 2;
        return { over: true, winner: winner as 1 | 2, reason: 'three_in_a_row' };
      }
    }
    if (!state.includes('.')) {
      return { over: true, reason: 'draw' };
    }
    return { over: false };
  },

  formatBoard(state: string): string {
    const s = state.split('').map((c, i) => c === '.' ? String(i) : c);
    return `${s[0]}|${s[1]}|${s[2]}\n-+-+-\n${s[3]}|${s[4]}|${s[5]}\n-+-+-\n${s[6]}|${s[7]}|${s[8]}`;
  }
};
