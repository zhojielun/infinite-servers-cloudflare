import { Hono } from "hono";
import { Env } from "../types";
import { isAuthenticated, validateToken } from "../auth";
import { getConfig } from "../kv";
import { getServerStatus } from "../db";

export const statusRoute = new Hono<{ Bindings: Env }>();

statusRoute.get("/status", async (c) => {
  const config = await getConfig(c.env);
  // SSE endpoint: also accept token via query param (EventSource can't send headers)
  const tokenParam = c.req.query("token");
  const authenticated = tokenParam
    ? await validateToken(c.env, tokenParam)
    : await isAuthenticated(c, c.env);
  if (config.password && !authenticated) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // SSE mode: keep connection open, push updates periodically
  if (c.req.query("sse") === "1") {
    const interval = Math.max(1, config.interval || 5);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = async () => {
          try {
            const status = await getServerStatus(c.env);
            const data = `data: ${JSON.stringify(status)}\n\n`;
            controller.enqueue(encoder.encode(data));
          } catch (_) {}
        };
        await send();
        const timer = setInterval(send, interval * 1000);
        // cleanup on disconnect
        c.req.raw.signal?.addEventListener("abort", () => {
          clearInterval(timer);
          controller.close();
        });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const status = await getServerStatus(c.env);
  return c.json(status);
});
