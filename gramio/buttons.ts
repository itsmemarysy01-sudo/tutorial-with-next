import type { BotLike } from "../util.ts";
import { listPostMessages, logActivity, setPostButtonUrl } from "../store.ts";
import { postKeyboard } from "../keyboards.ts";

/**
 * Re-points one button of a post and pushes the new keyboard onto every
 * Telegram message that post was published as.
 */
export async function updateButtonEverywhere(
  bot: BotLike,
  postId: string,
  buttonIdx: number,
  newUrl: string,
  actor: string,
) {
  const post = await setPostButtonUrl(postId, buttonIdx, newUrl);
  if (!post) return { updated: 0, failed: 0, found: false };

  const reply_markup = postKeyboard(post.buttons);
  let updated = 0;
  let failed = 0;
  for (const m of await listPostMessages(postId)) {
    try {
      await bot.api.editMessageReplyMarkup({ chat_id: m.chatId, message_id: m.messageId, reply_markup });
      updated++;
    } catch (err) {
      console.error(`edit ${m.chatId}/${m.messageId} failed`, err);
      failed++;
    }
  }

  await logActivity({
    actor,
    area: "Buttons",
    action: "update_url",
    detail: `post ${postId} button ${buttonIdx} -> ${updated} updated, ${failed} failed`,
  });
  return { updated, failed, found: true };
}
