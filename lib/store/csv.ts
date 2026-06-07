import { promises as fs } from "node:fs";
import path from "node:path";
import { put, head, list, del } from "@vercel/blob";

// File-per-record storage. The filename is historical — the *export*
// endpoint emits CSV, but on-disk / in-Blob each agent and each score is
// its own JSON file. This avoids the read-modify-write race that a single
// shared CSV file produces under concurrent Vercel lambdas.
//
// Layout:
//   agents/<agentId>.json                  — one Agent per file
//   scores/<agentId>/<scoreId>.json        — one Score per file, sharded
//
// Local dev (no BLOB_READ_WRITE_TOKEN): mirrors the layout under ./data/.
// Vercel (token present): same layout in the linked Blob store.

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

const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_PREFIX = "agents/";
const SCORES_PREFIX = "scores/";

const agentKey = (id: string) => `${AGENTS_PREFIX}${id}.json`;
const scoreKey = (agentId: string, scoreId: string) =>
  `${SCORES_PREFIX}${agentId}/${scoreId}.json`;
const scoresForAgentPrefix = (agentId: string) =>
  `${SCORES_PREFIX}${agentId}/`;

// ----- backend -----

const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

interface Backend {
  readJson<T>(key: string): Promise<T | null>;
  writeJson(key: string, value: unknown): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

// ----- filesystem backend (local dev) -----

async function walkDir(root: string, base: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(root, e.name);
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkDir(full, rel)));
    } else if (e.isFile() && e.name.endsWith(".json")) {
      out.push(rel);
    }
  }
  return out;
}

const fsBackend: Backend = {
  async readJson<T>(key: string): Promise<T | null> {
    const file = path.join(DATA_DIR, key);
    try {
      const text = await fs.readFile(file, "utf8");
      return JSON.parse(text) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async writeJson(key, value) {
    const file = path.join(DATA_DIR, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value), "utf8");
  },
  async listKeys(prefix) {
    const dir = path.join(DATA_DIR, prefix);
    return walkDir(dir, prefix.replace(/\/$/, ""));
  },
  async remove(key) {
    const file = path.join(DATA_DIR, key);
    try {
      await fs.unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  },
};

// ----- vercel blob backend -----

const blobBackend: Backend = {
  async readJson<T>(key: string): Promise<T | null> {
    let meta;
    try {
      meta = await head(key);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status: number }).status === 404
      ) {
        return null;
      }
      throw err;
    }
    // Use meta.url (not downloadUrl) — the CDN appears to keep serving
    // stale content on downloadUrl even with a cache-buster, whereas
    // the plain url respects no-cache once a unique query is appended.
    const bust = `${meta.url}${meta.url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(bust, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`blob fetch ${key} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  },
  async writeJson(key, value) {
    await put(key, JSON.stringify(value), {
      access: "public",
      contentType: "application/json; charset=utf-8",
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    });
  },
  async listKeys(prefix) {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) {
        if (b.pathname.endsWith(".json")) out.push(b.pathname);
      }
      cursor = page.cursor;
    } while (cursor);
    return out;
  },
  async remove(key) {
    try {
      await del(key);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status: number }).status === 404
      ) {
        return;
      }
      throw err;
    }
  },
};

const backend: Backend = useBlob ? blobBackend : fsBackend;

// ----- agents -----

export async function listAgents(): Promise<Agent[]> {
  const keys = await backend.listKeys(AGENTS_PREFIX);
  const agents = await Promise.all(
    keys.map((k) => backend.readJson<Agent>(k)),
  );
  return agents.filter((a): a is Agent => a !== null);
}

export async function getAgent(id: string): Promise<Agent | null> {
  return backend.readJson<Agent>(agentKey(id));
}

export async function insertAgent(agent: Agent): Promise<void> {
  await backend.writeJson(agentKey(agent.id), agent);
}

export async function updateAgent(
  id: string,
  patch: Partial<Omit<Agent, "id">>,
): Promise<void> {
  // Only this submission touches its own agent record, so the lack of
  // a global lock is fine — no other writer for this id.
  const current = await backend.readJson<Agent>(agentKey(id));
  if (!current) throw new Error(`agent ${id} not found`);
  const merged: Agent = { ...current, ...patch };
  await backend.writeJson(agentKey(id), merged);
}

export async function deleteAgent(id: string): Promise<void> {
  await backend.remove(agentKey(id));
  // Best-effort: also drop any persisted scores for this agent.
  const scoreKeys = await backend.listKeys(scoresForAgentPrefix(id));
  await Promise.all(scoreKeys.map((k) => backend.remove(k)));
}

// ----- scores -----

export async function listScores(agentId?: string): Promise<Score[]> {
  const prefix = agentId ? scoresForAgentPrefix(agentId) : SCORES_PREFIX;
  const keys = await backend.listKeys(prefix);
  const scores = await Promise.all(
    keys.map((k) => backend.readJson<Score>(k)),
  );
  return scores.filter((s): s is Score => s !== null);
}

export async function insertScore(score: Score): Promise<void> {
  // Each score has its own pathname — concurrent inserts can never
  // collide. This is the whole point of the file-per-record design.
  await backend.writeJson(scoreKey(score.agentId, score.id), score);
}

export const BACKEND = useBlob ? "blob" : "fs";
