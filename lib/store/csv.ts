import { promises as fs } from "node:fs";
import path from "node:path";
import { put, head } from "@vercel/blob";

// Storage backends:
//   - Local dev (no BLOB_READ_WRITE_TOKEN): ./data/*.csv on disk
//   - Vercel / token present:               Vercel Blob (read-modify-write)
//
// Both backends serialize per-file via an in-process mutex. Cross-instance
// races (e.g. two concurrent Vercel lambdas updating the same CSV) are
// possible — fine for demo traffic, not fine at scale.

export type AgentStatus = "pending" | "running" | "done" | "error";

export interface Agent {
  id: string;
  submitterName: string;
  name: string;
  modelLabel: string | null;
  crossCulturalDoc: string;
  nicheEvalDoc: string;
  biasScore: number | null;
  consistency: number | null;
  status: AgentStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Score {
  id: string;
  agentId: string;
  personaKey: string;
  score: number;
  reasoning: string;
  rawJson: string;
  createdAt: string;
}

const AGENTS_KEY = "agents.csv";
const SCORES_KEY = "scores.csv";
const DATA_DIR = path.join(process.cwd(), "data");

const AGENT_COLS = [
  "id",
  "submitter_name",
  "name",
  "model_label",
  "cross_cultural_doc",
  "niche_eval_doc",
  "bias_score",
  "consistency",
  "status",
  "error_message",
  "created_at",
  "completed_at",
] as const;

const SCORE_COLS = [
  "id",
  "agent_id",
  "persona_key",
  "score",
  "reasoning",
  "raw_json",
  "created_at",
] as const;

// ----- backend selection -----

const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

interface Backend {
  read(name: string): Promise<string>; // returns "" if missing
  write(name: string, content: string): Promise<void>;
}

const fsBackend: Backend = {
  async read(name) {
    const file = path.join(DATA_DIR, name);
    try {
      return await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  },
  async write(name, content) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, name), content, "utf8");
  },
};

const blobBackend: Backend = {
  async read(name) {
    // head() is strongly consistent on pathname — unlike list(), which can lag
    // a put by several seconds. downloadUrl + a per-request cache-buster
    // bypasses any CDN caching of the previous version.
    let meta;
    try {
      meta = await head(name);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status: number }).status === 404
      ) {
        return "";
      }
      throw err;
    }
    const bust = `${meta.downloadUrl}${meta.downloadUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(bust, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) return "";
      throw new Error(`blob fetch ${name} failed: ${res.status}`);
    }
    return await res.text();
  },
  async write(name, content) {
    await put(name, content, {
      access: "public",
      contentType: "text/csv; charset=utf-8",
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    });
  },
};

const rawBackend: Backend = useBlob ? blobBackend : fsBackend;

// Per-instance content cache. Blob reads can lag a put by several seconds
// (head's strong-consistency guarantees don't extend to the CDN content), so
// without this each chained insert* read returned the pre-write CSV and the
// final blob ended up with only the last write's row. Within a single Fluid
// Compute instance, the lock serializes access, so the cache is always the
// canonical state. Across instances we still diverge — fine for demo traffic.
const contentCache = new Map<string, string>();

const backend: Backend = {
  async read(name) {
    if (contentCache.has(name)) return contentCache.get(name)!;
    const text = await rawBackend.read(name);
    contentCache.set(name, text);
    return text;
  },
  async write(name, content) {
    contentCache.set(name, content);
    await rawBackend.write(name, content);
  },
};

// ----- mutex -----

const fileLocks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = (fileLocks.get(key) ?? Promise.resolve()) as Promise<unknown>;
  const next = prev.then(fn, fn);
  fileLocks.set(
    key,
    next.catch(() => undefined),
  );
  return next as Promise<T>;
}

// ----- CSV encode/decode -----

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function encodeRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (row.length === 1 && row[0] === "") {
        row = [];
        continue;
      }
      rows.push(row);
      row = [];
      continue;
    }
    cell += c;
    i++;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

async function readRecords(
  key: string,
  header: readonly string[],
): Promise<Record<string, string>[]> {
  const text = await backend.read(key);
  if (!text) return [];
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const [, ...data] = rows;
  return data.map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = cells[idx] ?? "";
    });
    return obj;
  });
}

async function writeRecords(
  key: string,
  header: readonly string[],
  rows: Record<string, unknown>[],
) {
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(encodeRow(header.map((h) => r[h])));
  }
  const text = lines.join("\n") + (rows.length > 0 ? "\n" : "");
  await backend.write(key, text);
}

// ----- serializers -----

function agentToRecord(a: Agent): Record<string, unknown> {
  return {
    id: a.id,
    submitter_name: a.submitterName,
    name: a.name,
    model_label: a.modelLabel,
    cross_cultural_doc: a.crossCulturalDoc,
    niche_eval_doc: a.nicheEvalDoc,
    bias_score: a.biasScore,
    consistency: a.consistency,
    status: a.status,
    error_message: a.errorMessage,
    created_at: a.createdAt,
    completed_at: a.completedAt,
  };
}

function recordToAgent(r: Record<string, string>): Agent {
  return {
    id: r.id,
    submitterName: r.submitter_name,
    name: r.name,
    modelLabel: r.model_label === "" ? null : r.model_label,
    crossCulturalDoc: r.cross_cultural_doc,
    nicheEvalDoc: r.niche_eval_doc,
    biasScore: r.bias_score === "" ? null : Number(r.bias_score),
    consistency: r.consistency === "" ? null : Number(r.consistency),
    status: (r.status as AgentStatus) || "pending",
    errorMessage: r.error_message === "" ? null : r.error_message,
    createdAt: r.created_at,
    completedAt: r.completed_at === "" ? null : r.completed_at,
  };
}

function scoreToRecord(s: Score): Record<string, unknown> {
  return {
    id: s.id,
    agent_id: s.agentId,
    persona_key: s.personaKey,
    score: s.score,
    reasoning: s.reasoning,
    raw_json: s.rawJson,
    created_at: s.createdAt,
  };
}

function recordToScore(r: Record<string, string>): Score {
  return {
    id: r.id,
    agentId: r.agent_id,
    personaKey: r.persona_key,
    score: Number(r.score),
    reasoning: r.reasoning,
    rawJson: r.raw_json,
    createdAt: r.created_at,
  };
}

// ----- public api -----

export async function listAgents(): Promise<Agent[]> {
  return withLock(AGENTS_KEY, async () => {
    const rows = await readRecords(AGENTS_KEY, AGENT_COLS);
    return rows.map(recordToAgent);
  });
}

export async function getAgent(id: string): Promise<Agent | null> {
  const agents = await listAgents();
  return agents.find((a) => a.id === id) ?? null;
}

export async function insertAgent(agent: Agent): Promise<void> {
  await withLock(AGENTS_KEY, async () => {
    const rows = await readRecords(AGENTS_KEY, AGENT_COLS);
    const agents = rows.map(recordToAgent);
    agents.push(agent);
    await writeRecords(AGENTS_KEY, AGENT_COLS, agents.map(agentToRecord));
  });
}

export async function updateAgent(
  id: string,
  patch: Partial<Omit<Agent, "id">>,
): Promise<void> {
  await withLock(AGENTS_KEY, async () => {
    const rows = await readRecords(AGENTS_KEY, AGENT_COLS);
    const agents = rows.map(recordToAgent);
    const idx = agents.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error(`agent ${id} not found`);
    agents[idx] = { ...agents[idx], ...patch };
    await writeRecords(AGENTS_KEY, AGENT_COLS, agents.map(agentToRecord));
  });
}

export async function listScores(agentId?: string): Promise<Score[]> {
  return withLock(SCORES_KEY, async () => {
    const rows = await readRecords(SCORES_KEY, SCORE_COLS);
    const all = rows.map(recordToScore);
    return agentId ? all.filter((s) => s.agentId === agentId) : all;
  });
}

export async function insertScore(score: Score): Promise<void> {
  await withLock(SCORES_KEY, async () => {
    const rows = await readRecords(SCORES_KEY, SCORE_COLS);
    const scores = rows.map(recordToScore);
    scores.push(score);
    await writeRecords(SCORES_KEY, SCORE_COLS, scores.map(scoreToRecord));
  });
}

export const BACKEND = useBlob ? "blob" : "fs";
