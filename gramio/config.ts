import type { Config } from "./types.ts";
import { env } from "./env.ts";

function need(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}_2 (or ${name})`);
  return v;
}

export function loadConfig(): Config {
  return {
    botToken: need("BOT_TOKEN"),
    ownerId: need("OWNER_ID"),
    webhookSecret: need("WEBHOOK_SECRET"),
    tzOffsetMinutes: Number(Deno.env.get("TZ_OFFSET_MINUTES") ?? "480"),
  };
}
