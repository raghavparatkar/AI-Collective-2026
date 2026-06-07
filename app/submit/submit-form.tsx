"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { buildVerdict } from "@/lib/evaluators/verdict";

type EvalEvent =
  | { type: "started"; agentId: string }
  | { type: "evaluator:done"; personaKey: string; score: number }
  | { type: "evaluator:error"; personaKey: string; error: string }
  | {
      type: "aggregate:done";
      agentId: string;
      biasScore: number;
      consistency: number;
      count: number;
    }
  | { type: "error"; error: string };

type PersonaStatus =
  | { state: "pending" }
  | { state: "done"; score: number }
  | { state: "error"; message: string };

interface Props {
  personaKeys: string[];
}

export default function SubmitForm({ personaKeys }: Props) {
  const router = useRouter();
  const [submitterName, setSubmitterName] = useState("");
  const [name, setName] = useState("");
  const [modelLabel, setModelLabel] = useState("");
  const [crossDoc, setCrossDoc] = useState("");
  const [nicheDoc, setNicheDoc] = useState("");
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, PersonaStatus>>({});
  const [aggregate, setAggregate] = useState<
    { biasScore: number; consistency: number; agentId: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const verdict = useMemo(() => {
    const scored = Object.entries(statuses)
      .filter(([, s]) => s.state === "done")
      .map(([personaKey, s]) => ({
        personaKey,
        score: (s as { state: "done"; score: number }).score,
      }));
    return scored.length > 0 ? buildVerdict(scored) : null;
  }, [statuses]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setAggregate(null);
    setStatuses(
      Object.fromEntries(personaKeys.map((k) => [k, { state: "pending" }])),
    );

    const res = await fetch("/api/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submitterName: submitterName || "anonymous",
        name,
        modelLabel: modelLabel || null,
        crossCulturalDoc: crossDoc,
        nicheEvalDoc: nicheDoc,
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      setError(`Submission failed: ${text || res.statusText}`);
      setRunning(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(6)) as EvalEvent;
          handleEvent(event);
        } catch {
          // ignore unparseable chunks
        }
      }
    }
    setRunning(false);

    function handleEvent(event: EvalEvent) {
      switch (event.type) {
        case "evaluator:done":
          setStatuses((s) => ({
            ...s,
            [event.personaKey]: { state: "done", score: event.score },
          }));
          break;
        case "evaluator:error":
          setStatuses((s) => ({
            ...s,
            [event.personaKey]: { state: "error", message: event.error },
          }));
          break;
        case "aggregate:done":
          setAggregate({
            biasScore: event.biasScore,
            consistency: event.consistency,
            agentId: event.agentId,
          });
          setTimeout(() => router.push(`/agent/${event.agentId}`), 5000);
          break;
        case "error":
          setError(event.error);
          break;
      }
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset disabled={running} className="space-y-6 disabled:opacity-60">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Your name">
            <input
              type="text"
              value={submitterName}
              onChange={(e) => setSubmitterName(e.target.value)}
              placeholder="anonymous"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Agent name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent-v3"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
              required
            />
          </Field>
          <Field label="Model label (optional)">
            <input
              type="text"
              value={modelLabel}
              onChange={(e) => setModelLabel(e.target.value)}
              placeholder="e.g. gpt-4.1"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <Field
          label="Cross-cultural doc"
          hint="Your agent's views on broad events, values, or contested cases."
          required
        >
          <textarea
            value={crossDoc}
            onChange={(e) => setCrossDoc(e.target.value)}
            rows={10}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono"
            required
          />
        </Field>

        <Field
          label="Niche situational eval"
          hint="A narrower, scenario-specific reasoning sample."
          required
        >
          <textarea
            value={nicheDoc}
            onChange={(e) => setNicheDoc(e.target.value)}
            rows={10}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono"
            required
          />
        </Field>

        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900"
        >
          {running ? "Evaluating…" : "Run evaluation"}
        </button>
      </fieldset>

      {(running || Object.keys(statuses).length > 0) && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-2">
          <div className="text-sm font-medium mb-2">Evaluator progress</div>
          <ul className="space-y-1.5 text-sm font-mono">
            {personaKeys.map((key) => {
              const s = statuses[key] ?? { state: "pending" as const };
              return (
                <li key={key} className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {key}
                  </span>
                  <span>
                    {s.state === "pending" && (
                      <span className="text-zinc-400">…</span>
                    )}
                    {s.state === "done" && (
                      <span className="font-semibold tabular-nums">
                        {s.score}
                      </span>
                    )}
                    {s.state === "error" && (
                      <span className="text-red-500 text-xs">
                        error: {s.message}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {aggregate && (
            <div className="mt-4 rounded-md bg-zinc-100 dark:bg-zinc-900 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm">Bias score</span>
                <span className="text-2xl font-bold tabular-nums">
                  {aggregate.biasScore.toFixed(1)}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-xs text-zinc-500 mt-1">
                <span>Consistency</span>
                <span className="tabular-nums">
                  {aggregate.consistency.toFixed(1)}
                </span>
              </div>
              {verdict && (
                <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
                  {verdict.headline}
                </p>
              )}
              <div className="text-xs text-zinc-500 mt-2">
                Opening detail page in a few seconds…
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
