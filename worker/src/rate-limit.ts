import type { Context } from "hono";
import type { Env } from "./types";
import { getClientIP } from "./auth";

interface RateLimitConfig {
  windowSec: number;
  maxRequests: number;
}

const LIMITS: Record<string, RateLimitConfig> = {
  write: { windowSec: 60, maxRequests: 30 },
  read: { windowSec: 60, maxRequests: 120 },
};

export function rateLimit(tier: "write" | "read") {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    try {
      const config = LIMITS[tier];
      const ip = getClientIP(c);
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - config.windowSec;

      const row = await c.env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM rate_limits WHERE ip = ? AND ts >= ?",
      )
        .bind(ip, windowStart)
        .first<{ cnt: number }>();

      const count = row?.cnt ?? 0;
      if (count >= config.maxRequests) {
        return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
      }

      await c.env.DB.prepare(
        "INSERT INTO rate_limits (ip, ts) VALUES (?, ?)",
      )
        .bind(ip, now)
        .run();

      // cleanup old entries periodically (1% chance per request)
      if (Math.random() < 0.01) {
        const expire = now - 3600; // keep last 1 hour
        await c.env.DB.prepare("DELETE FROM rate_limits WHERE ts < ?").bind(expire).run();
      }
    } catch (_) {
      // rate_limits 表不存在时跳过频率限制，不阻塞请求
    }

    await next();
  };
}

export async function ensureRateLimitTable(env: Env): Promise<void> {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      ts INTEGER NOT NULL
    )
  `);
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_ts ON rate_limits(ip, ts)",
  );
}
