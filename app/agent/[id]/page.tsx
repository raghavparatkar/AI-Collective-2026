import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgent, listScores } from "@/lib/store/csv";
import { PERSONAS, type PersonaAxis } from "@/lib/evaluators/personas";
import { buildVerdict } from "@/lib/evaluators/verdict";

export const dynamic = "force-dynamic";

const AXIS_ORDER: PersonaAxis[] = [
  "cultural",
  "ideological",
  "demographic",
  "adversarial",
];

const AXIS_LABEL: Record<PersonaAxis, string> = {
  cultural: "Cultural perspectives",
  ideological: "Ideological perspectives",
  demographic: "Demographic perspectives",
  adversarial: "Adversarial",
};

export default async function AgentDetail({
  params,
}: PageProps<"/agent/[id]">) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();
  const scores = await listScores(id);
  const scoresByKey = new Map(scores.map((s) => [s.personaKey, s]));
  const verdict = buildVerdict(
    scores.map((s) => ({ personaKey: s.personaKey, score: s.score })),
  );

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← back to leaderboard
        </Link>
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {agent.name}
            </h1>
            <div className="text-sm text-zinc-500 mt-1 space-x-3">
              {agent.modelLabel && (
                <span className="font-mono">{agent.modelLabel}</span>
              )}
              <span>submitted by {agent.submitterName || "anonymous"}</span>
              <span>{agent.createdAt.slice(0, 10)}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <StatBox label="Bias score" value={agent.biasScore} large />
            <StatBox label="Consistency" value={agent.consistency} />
          </div>
        </div>
        {agent.status !== "done" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 px-4 py-3 text-sm">
            Status: <strong>{agent.status}</strong>
            {agent.errorMessage && (
              <div className="text-xs mt-1 font-mono">{agent.errorMessage}</div>
            )}
          </div>
        )}
        {agent.status === "done" && scores.length > 0 && (
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500 mr-2">
              Verdict
            </span>
            {verdict.headline}
          </div>
        )}
      </header>

      {AXIS_ORDER.map((axis) => {
        const personas = PERSONAS.filter((p) => p.axis === axis);
        if (personas.length === 0) return null;
        return (
          <section key={axis} className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              {AXIS_LABEL[axis]}
            </h2>
            <div className="space-y-3">
              {personas.map((p) => {
                const s = scoresByKey.get(p.key);
                return (
                  <div
                    key={p.key}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4"
                  >
                    <div className="flex items-baseline justify-between mb-3">
                      <div>
                        <div className="font-medium">{p.label}</div>
                        <div className="text-xs font-mono text-zinc-500">
                          {p.key}
                        </div>
                      </div>
                      <div className="text-2xl font-bold tabular-nums">
                        {s?.score?.toFixed(0) ?? "—"}
                      </div>
                    </div>
                    {s && <ScoreBar score={s.score} />}
                    {s?.reasoning && (
                      <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                        {s.reasoning}
                      </p>
                    )}
                    <PersonaExtras rawJson={s?.rawJson} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Source documents
        </h2>
        <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Cross-cultural doc
          </summary>
          <pre className="mt-3 text-xs whitespace-pre-wrap font-mono text-zinc-700 dark:text-zinc-300">
            {agent.crossCulturalDoc}
          </pre>
        </details>
        <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Niche situational eval
          </summary>
          <pre className="mt-3 text-xs whitespace-pre-wrap font-mono text-zinc-700 dark:text-zinc-300">
            {agent.nicheEvalDoc}
          </pre>
        </details>
      </section>
    </div>
  );
}

function StatBox({
  label,
  value,
  large,
}: {
  label: string;
  value: number | null;
  large?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-5 py-3 text-right">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={
          "tabular-nums font-bold " +
          (large ? "text-4xl" : "text-2xl text-zinc-700 dark:text-zinc-300")
        }
      >
        {value?.toFixed(1) ?? "—"}
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color =
    score >= 70
      ? "bg-emerald-500"
      : score >= 50
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="h-1.5 w-full rounded bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function PersonaExtras({ rawJson }: { rawJson: string | undefined }) {
  if (!rawJson) return null;
  let parsed: { input?: { flags?: string[]; exemplary_quotes?: string[] } };
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  const flags = parsed.input?.flags ?? [];
  const quotes = parsed.input?.exemplary_quotes ?? [];
  if (flags.length === 0 && quotes.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
      {flags.length > 0 && (
        <div>
          <div className="font-medium text-zinc-500 mb-1">Flags</div>
          <ul className="space-y-1">
            {flags.map((f, i) => (
              <li key={i} className="text-zinc-700 dark:text-zinc-300">
                • {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quotes.length > 0 && (
        <div>
          <div className="font-medium text-zinc-500 mb-1">Cited quotes</div>
          <ul className="space-y-1">
            {quotes.map((q, i) => (
              <li
                key={i}
                className="border-l-2 border-zinc-200 dark:border-zinc-700 pl-2 text-zinc-700 dark:text-zinc-300"
              >
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
