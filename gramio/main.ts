/**
 * Serverless entry point (Deno Deploy).
 *
 *   POST /webhook/<WEBHOOK_SECRET>  -> Telegram delivers updates here
 *   GET  /health                    -> uptime check
 *   GET  /cron/<WEBHOOK_SECRET>     -> manual/external trigger for due posts
 *
 * Scheduled posts are published by Deno.cron every minute - no server, no
 * always-on process, and the owner's phone never needs to be online.
 */
import { webhookHandler } from "gramio";
import { loadConfig } from "./src/config.ts";
import { createBot } from "./src/bot.ts";
import { runDueSchedules } from "./src/features/schedule.ts";

const config = loadConfig();
const bot = createBot(config);
const handleUpdate = webhookHandler(bot, "std/http");

// Fetches bot info once per isolate, if this GramIO version exposes init().
let ready: Promise<void> | undefined;
function ensureInit(): Promise<void> {
  return (ready ??= (async () => {
    const b = bot as unknown as { init?: () => Promise<unknown> };
    if (typeof b.init === "function") await b.init();
  })());
}

/** Constant-time string comparison for secrets. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

Deno.cron("publish-due-posts", "* * * * *", async () => {
  try {
    const n = await runDueSchedules(bot);
    if (n) console.log(`cron: published ${n} scheduled post(s)`);
  } catch (err) {
    console.error("cron failed", err);
  }
});

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response("Telegram-Bot is running.", { status: 200 });
  }

  if (req.method === "GET" && url.pathname === `/cron/${config.webhookSecret}`) {
    const n = await runDueSchedules(bot);
    return Response.json({ published: n });
  }

  if (req.method === "POST" && url.pathname === `/webhook/${config.webhookSecret}`) {
    // Telegram echoes the secret_token we registered in setWebhook.
    const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!safeEqual(header, config.webhookSecret)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      await ensureInit();
      return await handleUpdate(req);
    } catch (err) {
      // Always 200 so Telegram doesn't endlessly retry a poisonous update.
      console.error("update failed", err);
      return new Response("ok", { status: 200 });
    }
  }

  return new Response("Not found", { status: 404 });
});
