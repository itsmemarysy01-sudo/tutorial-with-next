import type { Config } from "./types.ts";

function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
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
