import type { Repositories } from "../repos";
import { SECRET_CANDIDATE_TOKENS, containsSecret } from "./pii";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; count: number }>();

export async function countRunsWithSecrets(repos: Repositories, userId: string, days = 7): Promise<number> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.count;
  }
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [runs, events] = await Promise.all([
    repos.runs.findTextMatches(userId, since, SECRET_CANDIDATE_TOKENS, 1000),
    repos.events.findTextMatches(userId, since, SECRET_CANDIDATE_TOKENS, 2000),
  ]);
  const ids = new Set<string>();
  for (const row of [...runs, ...events]) {
    if (containsSecret(row.text)) {
      ids.add(row.runId);
    }
  }
  const count = ids.size;
  cache.set(userId, { at: Date.now(), count });
  return count;
}
