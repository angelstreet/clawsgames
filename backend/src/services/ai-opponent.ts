/**
 * AI Opponent Service — free OpenRouter models
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getKey() { return process.env.OPENROUTER_API_KEY || ''; }

export const AI_MODELS = [
  { id: 'arcee-ai/trinity-large-preview:free', name: 'Trinity Large', tier: 'default' },
  { id: 'nvidia/nemotron-nano-9b-v2:free', name: 'Nemotron Nano 9B', tier: 'medium' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B', tier: 'strong' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron 30B', tier: 'strong' },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'Nemotron 12B VL', tier: 'medium' },
];

const DEFAULT_MODEL = AI_MODELS[0].id;

function fallbackMoveTictactoe(state: string): string {
  const priority = [4, 0, 2, 6, 8, 1, 3, 5, 7];
  for (const pos of priority) {
    if (state[pos] === '.') return String(pos);
  }
  return '0';
}

function fallbackMoveChess(): string {
  const openings = ['e4', 'd4', 'Nf3', 'c4', 'g3'];
  return openings[Math.floor(Math.random() * openings.length)];
}

export function getAvailableModels() {
  return AI_MODELS.map(m => ({ id: m.id, name: m.name, tier: m.tier }));
}

export async function getAIMove(
  gameId: string,
  boardDisplay: string,
  boardState: string,
  playerNumber: 1 | 2,
  moveHistory: string[],
  modelId?: string,
): Promise<{ move: string; model_used: string; fallback: boolean }> {
  const model = modelId || DEFAULT_MODEL;

  let systemPrompt: string;
  let userPrompt: string;

  if (gameId === 'tictactoe') {
    const mark = playerNumber === 1 ? 'X' : 'O';
    systemPrompt = `You are playing Tic-Tac-Toe as ${mark}. Board positions are 0-8 (top-left to bottom-right). Respond with ONLY a single digit (0-8). No explanation.`;
    userPrompt = `Board:\n${boardDisplay}\n\nAvailable: ${boardState.split('').map((c, i) => c === '.' ? i : null).filter(x => x !== null).join(', ')}\nYour move:`;
  } else if (gameId === 'chess') {
    const color = playerNumber === 1 ? 'White' : 'Black';
    const moves = moveHistory.length > 0 ? `Moves: ${moveHistory.join(' ')}` : 'Game start.';
    systemPrompt = `You are playing Chess as ${color}. Respond with ONLY your move in SAN (e.g. e4, Nf3, O-O). No explanation.`;
    userPrompt = `${moves}\n\n${boardDisplay}\n\nYour move:`;
  } else if (gameId === 'pokemon') {
    systemPrompt = `You are in a Pokemon battle as Player ${playerNumber}. Choose your action. Respond with ONLY one of:
- "move 1" through "move 4" to use an attack
- "switch 2" through "switch 6" to switch Pokemon
Respond with ONLY the command, nothing else.`;
    userPrompt = boardDisplay + '\nYour action:';
  } else {
    return { move: '0', model_used: 'fallback', fallback: true };
  }

  const key = getKey();
  if (key) {
    const modelsToTry = [model, ...AI_MODELS.map(m => m.id).filter(m => m !== model)];

    for (const tryModel of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://clawsgames.angelstreet.io',
            'X-Title': 'ClawsGames',
          },
          body: JSON.stringify({
            model: tryModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 30,
            temperature: 0.3,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) continue;

        const data = await response.json() as any;
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) continue;

        let move: string;
        if (gameId === 'tictactoe') {
          const match = content.match(/\d/);
          move = match ? match[0] : content;
        } else {
          move = content.split(/\s/)[0].replace(/[.!?,]$/g, '');
        }

        return { move, model_used: tryModel, fallback: false };
      } catch {
        continue;
      }
    }
  }

  const move = gameId === 'tictactoe' ? fallbackMoveTictactoe(boardState) : gameId === 'pokemon' ? 'move 1' : fallbackMoveChess();
  return { move, model_used: 'fallback-logic', fallback: true };
}
