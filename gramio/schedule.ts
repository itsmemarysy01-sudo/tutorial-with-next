import type { BotLike } from "../util.ts";
import { claimDueScheduled, logActivity } from "../store.ts";
import { publishPost } from "./publish.ts";

/**
 * Publishes everything whose time has come. Called every minute by
 * Deno.cron (see main.ts). Safe to run concurrently: claimDueScheduled
 * hands each post to exactly one caller.
 */
export async function runDueSchedules(bot: BotLike): Promise<number> {
  const due = await claimDueScheduled();
  for (const s of due) {
    try {
      const r = await publishPost(bot, {
        label: `Scheduled ${s.id}`,
        text: s.text,
        buttons: s.buttons,
        destinations: s.destinations,
        actor: "scheduler",
      });
      await logActivity({
        actor: "scheduler",
        area: "Schedule",
        action: "published",
        detail: `${s.id}: ${r.sent} ok, ${r.failed.length} failed`,
      });
    } catch (err) {
      console.error(`scheduled post ${s.id} failed`, err);
      await logActivity({ actor: "scheduler", area: "Schedule", action: "failed", detail: s.id });
    }
  }
  return due.length;
}
