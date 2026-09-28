// Removes the webhook (e.g. before switching back to long polling).
import { env } from "./env.ts";

const token = env("BOT_TOKEN");
if (!token) {
  console.error("Set BOT_TOKEN_2 in .env first.");
  Deno.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: "POST" });
console.log(await res.json());

export {};
