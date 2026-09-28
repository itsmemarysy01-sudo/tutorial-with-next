/**
 * Local development runner: long polling instead of a public webhook, so you
 * don't need a tunnel. Uses the same bot, same Deno KV (a local file), and
 * checks for due scheduled posts every 30 seconds.
 *
 *   deno task dev
 */
import { loadConfig } from "./config.ts";
import { createBot } from "./bot.ts";
import { runDueSchedules } from "./features/schedule.ts";

const config = loadConfig();
const bot = createBot(config);

// Telegram refuses long polling while a webhook is registered.
await fetch(`https://api.telegram.org/bot${config.botToken}/deleteWebhook`, { method: "POST" });

setInterval(async () => {
  try {
    const n = await runDueSchedules(bot);
    if (n) console.log(`published ${n} scheduled post(s)`);
  } catch (err) {
    console.error("scheduler tick failed", err);
  }
}, 30_000);

bot.onStart(({ info }) => console.log(`Dev bot running as @${info.username} (long polling)`));
await bot.start();
