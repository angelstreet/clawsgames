/**
 * Report game results to Ranking of Claws
 */
const ROC_URL = process.env.ROC_API_URL || 'http://localhost:5013';

export async function reportToRoC(data: {
  gateway_id: string;
  agent_name: string;
  game: string;
  result: 'win' | 'loss' | 'draw';
  opponent_gateway_id?: string;
  opponent_name?: string;
  elo_before: number;
  elo_after: number;
  match_id: string;
}) {
  try {
    await fetch(`${ROC_URL}/api/report/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error('RoC report failed:', err);
  }
}
