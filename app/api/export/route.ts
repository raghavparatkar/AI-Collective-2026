import { listAgents, listScores } from "@/lib/store/csv";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return new Response("ADMIN_TOKEN not configured", { status: 500 });
  }
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!constantTimeEq(token, expected)) {
    return new Response("forbidden", { status: 403 });
  }

  const [agents, scores] = await Promise.all([listAgents(), listScores()]);
  const scoresByAgent = new Map<string, typeof scores>();
  for (const s of scores) {
    const arr = scoresByAgent.get(s.agentId) ?? [];
    arr.push(s);
    scoresByAgent.set(s.agentId, arr);
  }

  const header = [
    "agent_id",
    "agent_name",
    "model_label",
    "submitted_by",
    "bias_score",
    "consistency",
    "status",
    "created_at",
    "completed_at",
    "persona_key",
    "persona_score",
    "persona_reasoning",
  ];

  const lines: string[] = [header.join(",")];
  for (const a of agents) {
    const agentScores = scoresByAgent.get(a.id) ?? [];
    if (agentScores.length === 0) {
      lines.push(
        [
          a.id,
          a.name,
          a.modelLabel,
          a.submitterName,
          a.biasScore,
          a.consistency,
          a.status,
          a.createdAt,
          a.completedAt,
          "",
          "",
          "",
        ]
          .map(csvCell)
          .join(","),
      );
      continue;
    }
    for (const s of agentScores) {
      lines.push(
        [
          a.id,
          a.name,
          a.modelLabel,
          a.submitterName,
          a.biasScore,
          a.consistency,
          a.status,
          a.createdAt,
          a.completedAt,
          s.personaKey,
          s.score,
          s.reasoning,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agent-evals-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
