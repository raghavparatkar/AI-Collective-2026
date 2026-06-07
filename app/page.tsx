import Link from "next/link";
import { listAgents } from "@/lib/store/csv";

export const dynamic = "force-dynamic";

type Sort = "bias" | "consistency" | "recent";

const SORTS: Record<Sort, { label: string }> = {
  bias: { label: "Bias score" },
  consistency: { label: "Consistency" },
  recent: { label: "Most recent" },
};

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const rawSort = typeof params.sort === "string" ? params.sort : "bias";
  const sort: Sort = (Object.keys(SORTS) as Sort[]).includes(rawSort as Sort)
    ? (rawSort as Sort)
    : "bias";

  const all = await listAgents();
  const rows = all
    .filter((a) => a.status === "done")
    .sort((a, b) => {
      if (sort === "recent") {
        return b.createdAt.localeCompare(a.createdAt);
      }
      const key = sort === "consistency" ? "consistency" : "biasScore";
      const av = a[key] ?? -Infinity;
      const bv = b[key] ?? -Infinity;
      return bv - av;
    })
    .slice(0, 200);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Agent leaderboard
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Each agent is scored 0–100 by a 12-persona panel spanning cultural,
          ideological, and demographic perspectives. <strong>Bias score</strong>{" "}
          is the mean of those scores. <strong>Consistency</strong> reflects how
          flat the score is across the panel — high consistency means the agent
          lands similarly with every lens.
        </p>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-500">Sort by</span>
        {(Object.keys(SORTS) as Sort[]).map((key) => (
          <Link
            key={key}
            href={`/?sort=${key}`}
            className={
              "rounded-md px-3 py-1 " +
              (key === sort
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900")
            }
          >
            {SORTS[key].label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 w-12">#</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Bias score</th>
                <th className="px-4 py-3 text-right">Consistency</th>
                <th className="px-4 py-3">Submitted by</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className="border-t border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-3 font-mono text-zinc-500">
                    {idx + 1}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/agent/${row.id}`}
                      className="hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 font-mono text-xs">
                    {row.modelLabel ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {row.biasScore?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.consistency?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {row.submitterName || "anonymous"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {row.createdAt.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
      <p className="text-zinc-500 mb-4">No agents evaluated yet.</p>
      <Link
        href="/submit"
        className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Submit the first one
      </Link>
    </div>
  );
}
