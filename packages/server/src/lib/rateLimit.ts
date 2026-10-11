import type { FastifyInstance } from "fastify";

export interface RateRule {
  prefix: string;
  max: number | (() => number);
  windowMs: number;
}

const buckets = new Map<string, number[]>();

export function installRateLimits(app: FastifyInstance, rules: RateRule[]): void {
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0];
    const rule = rules.find((r) => url.startsWith(r.prefix));
    if (!rule) {
      return;
    }
    const key = `${rule.prefix}|${request.ip}`;
    const now = Date.now();
    let times = buckets.get(key);
    if (!times) {
      times = [];
      buckets.set(key, times);
    }
    times = times.filter((t) => now - t < rule.windowMs);
    const max = typeof rule.max === "function" ? rule.max() : rule.max;
    if (times.length >= max) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    times.push(now);
  });
}