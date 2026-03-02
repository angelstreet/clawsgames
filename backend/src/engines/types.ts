export interface MoveResult {
  valid: boolean;
  newState?: string;
  error?: string;
}

export interface GameOverResult {
  over: boolean;
  winner?: 1 | 2;
  reason?: string;
}

export interface GameEngine {
  id: string;
  name: string;
  initialState(): string;
  validateMove(state: string, move: string, player: 1 | 2): MoveResult;
  isGameOver(state: string): GameOverResult;
  formatBoard(state: string): string;
}
