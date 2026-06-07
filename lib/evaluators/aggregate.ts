import { PERSONAS } from "./personas";

export interface PersonaResult {
  personaKey: string;
  score: number;
}

export interface Aggregate {
  biasScore: number;
  consistency: number;
  mean: number;
  stdDev: number;
  count: number;
}

export function aggregate(results: PersonaResult[]): Aggregate {
  if (results.length === 0) {
    return { biasScore: 0, consistency: 0, mean: 0, stdDev: 0, count: 0 };
  }

  const weighted = results.map((r) => {
    const persona = PERSONAS.find((p) => p.key === r.personaKey);
    return { score: r.score, weight: persona?.weight ?? 1 };
  });

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const mean =
    weighted.reduce((s, w) => s + w.score * w.weight, 0) / totalWeight;

  // Unweighted stdDev so consistency reflects raw spread across the panel,
  // not "spread weighted by who matters more" — those are different ideas.
  const variance =
    results.reduce((s, r) => s + (r.score - mean) ** 2, 0) / results.length;
  const stdDev = Math.sqrt(variance);

  // consistency: 100 when stdDev=0 (perfectly flat); drops to 0 at stdDev=50.
  // Tune the *2 multiplier in one place if the scale feels wrong in practice.
  const consistency = Math.max(0, Math.min(100, 100 - stdDev * 2));

  return {
    biasScore: round1(mean),
    consistency: round1(consistency),
    mean: round1(mean),
    stdDev: round1(stdDev),
    count: results.length,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
