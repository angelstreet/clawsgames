const K = 32;

export function calculateElo(ratingA: number, ratingB: number, scoreA: number): { newA: number; newB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  const scoreB = 1 - scoreA;

  return {
    newA: Math.round(ratingA + K * (scoreA - expectedA)),
    newB: Math.round(ratingB + K * (scoreB - expectedB)),
  };
}
