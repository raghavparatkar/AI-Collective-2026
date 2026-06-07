import { PERSONAS, type PersonaAxis } from "./personas";

const AXIS_NOUN: Record<PersonaAxis, string> = {
  cultural: "cultural lenses",
  ideological: "ideological lenses",
  demographic: "demographic lenses",
  adversarial: "adversarial probing",
};

export interface VerdictInput {
  personaKey: string;
  score: number;
}

export interface AxisMean {
  axis: PersonaAxis;
  mean: number;
  count: number;
}

export interface Verdict {
  headline: string;
  overall: number;
  axisMeans: AxisMean[];
  strongest: AxisMean | null;
  weakest: AxisMean | null;
}

export function buildVerdict(scores: VerdictInput[]): Verdict {
  const byAxis = new Map<PersonaAxis, number[]>();
  for (const s of scores) {
    const persona = PERSONAS.find((p) => p.key === s.personaKey);
    if (!persona) continue;
    const arr = byAxis.get(persona.axis) ?? [];
    arr.push(s.score);
    byAxis.set(persona.axis, arr);
  }

  const axisMeans: AxisMean[] = Array.from(byAxis.entries()).map(
    ([axis, arr]) => ({
      axis,
      mean: arr.reduce((a, b) => a + b, 0) / arr.length,
      count: arr.length,
    }),
  );

  if (scores.length === 0 || axisMeans.length === 0) {
    return {
      headline: "Not enough scores to summarize yet.",
      overall: 0,
      axisMeans: [],
      strongest: null,
      weakest: null,
    };
  }

  const overall = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  const sorted = [...axisMeans].sort((a, b) => b.mean - a.mean);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const gap = strongest.mean - weakest.mean;

  let headline: string;
  if (axisMeans.length < 2 || gap < 5) {
    if (overall >= 70) {
      headline = `Broadly strong across every lens (avg ${overall.toFixed(0)}).`;
    } else if (overall >= 50) {
      headline = `Mixed but even across lenses (avg ${overall.toFixed(0)}).`;
    } else {
      headline = `Broadly weak across every lens (avg ${overall.toFixed(0)}).`;
    }
  } else {
    headline = `Strong on ${AXIS_NOUN[strongest.axis]} (${strongest.mean.toFixed(0)}), weak on ${AXIS_NOUN[weakest.axis]} (${weakest.mean.toFixed(0)}).`;
  }

  return { headline, overall, axisMeans, strongest, weakest };
}

export function axisLabel(axis: PersonaAxis): string {
  return AXIS_NOUN[axis];
}
