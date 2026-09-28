// Registers your deployed URL as the bot's permanent address with Telegram.
//   deno task webhook:set
import { env } from "./env.ts";

const token = env("BOT_TOKEN");
const secret = env("WEBHOOK_SECRET");
const publicUrl = Deno.env.get("PUBLIC_URL");
if (!token || !secret || !publicUrl) {
  console.error("Set BOT_TOKEN_2, WEBHOOK_SECRET_2 and PUBLIC_URL in .env first.");
  Deno.exit(1);
}

const url = `${publicUrl.replace(/\/$/, "")}/webhook/${secret}`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: true,
  }),
});
const body = await res.json();
console.log(body.ok ? `Webhook set -> ${publicUrl}/webhook/<secret>` : body);

export {};
