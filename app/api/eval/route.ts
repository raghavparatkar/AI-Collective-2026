import { randomUUID } from "node:crypto";
import {
  insertAgent,
  insertScore,
  updateAgent,
  type Agent,
} from "@/lib/store/csv";
import { runEvalPanel, type PersonaEvalOutcome } from "@/lib/evaluators/run";
import { aggregate } from "@/lib/evaluators/aggregate";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_DOC_LEN = 50_000;

interface SubmitBody {
  submitterName?: string;
  name?: string;
  modelLabel?: string | null;
  crossCulturalDoc?: string;
  nicheEvalDoc?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as SubmitBody;
  const submitterName = body.submitterName?.trim() || "anonymous";
  const name = body.name?.trim();
  const cross = body.crossCulturalDoc?.trim();
  const niche = body.nicheEvalDoc?.trim();
  const modelLabel = body.modelLabel?.trim() || null;

  if (!name || !cross || !niche) {
    return Response.json(
      { error: "name, crossCulturalDoc, and nicheEvalDoc are required" },
      { status: 400 },
    );
  }
  if (cross.length > MAX_DOC_LEN || niche.length > MAX_DOC_LEN) {
    return Response.json(
      { error: `docs must be <= ${MAX_DOC_LEN} chars each` },
      { status: 400 },
    );
  }

  const agentId = randomUUID();
  const now = new Date().toISOString();

  const agent: Agent = {
    id: agentId,
    submitterName,
    name,
    modelLabel,
    crossCulturalDoc: cross,
    nicheEvalDoc: niche,
    biasScore: null,
    consistency: null,
    status: "running",
    errorMessage: null,
    createdAt: now,
    completedAt: null,
  };
  await insertAgent(agent);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      send({ type: "started", agentId });

      const onProgress = async (outcome: PersonaEvalOutcome) => {
        if (outcome.ok) {
          const r = outcome.result;
          await insertScore({
            id: randomUUID(),
            agentId,
            personaKey: r.personaKey,
            score: r.score,
            reasoning: r.reasoning,
            rawJson: JSON.stringify(r.raw),
            createdAt: new Date().toISOString(),
          });
          send({
            type: "evaluator:done",
            personaKey: r.personaKey,
            score: r.score,
          });
        } else {
          send({
            type: "evaluator:error",
            personaKey: outcome.error.personaKey,
            error: outcome.error.error,
          });
        }
      };

      try {
        const outcomes = await runEvalPanel(
          { crossCulturalDoc: cross, nicheEvalDoc: niche },
          { onProgress },
        );
        const successes = outcomes.flatMap((o) =>
          o.ok ? [{ personaKey: o.result.personaKey, score: o.result.score }] : [],
        );

        if (successes.length === 0) {
          await updateAgent(agentId, {
            status: "error",
            errorMessage: "all evaluators failed",
            completedAt: new Date().toISOString(),
          });
          send({ type: "error", error: "all evaluators failed" });
        } else {
          const agg = aggregate(successes);
          await updateAgent(agentId, {
            status: "done",
            biasScore: agg.biasScore,
            consistency: agg.consistency,
            completedAt: new Date().toISOString(),
          });
          send({
            type: "aggregate:done",
            agentId,
            biasScore: agg.biasScore,
            consistency: agg.consistency,
            count: agg.count,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateAgent(agentId, {
          status: "error",
          errorMessage: msg,
          completedAt: new Date().toISOString(),
        });
        send({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
