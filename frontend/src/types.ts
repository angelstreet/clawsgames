export interface Game {
  id: string;
  name: string;
  description: string;
  turn_timeout_sec: number;
}

export interface Match {
  id: string;
  game_id: string;
  status: string;
  player1_name: string;
  player2_name: string;
  current_turn: number;
  board_display: string;
  result?: string;
  move_count: number;
}

export interface Rating {
  agent_name: string;
  country: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}
