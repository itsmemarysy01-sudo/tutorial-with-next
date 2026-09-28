import type { BotLike } from "../util.ts";
import { listUsersByStatus, logActivity } from "../store.ts";
import { sleep } from "../util.ts";

/** Sends an announcement to every approved user (workflow area: Broadcast). */
export async function broadcastToApproved(bot: BotLike, text: string, actor: string) {
  const users = await listUsersByStatus("approved");
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      await bot.api.sendMessage({ chat_id: u.userId, text });
      sent++;
    } catch {
      failed++; // user may have blocked the bot
    }
    await sleep(50); // stay well under Telegram's ~30 msgs/sec limit
  }
  await logActivity({ actor, area: "Broadcast", action: "send", detail: `${sent} ok, ${failed} failed` });
  return { sent, failed };
}
