import type { BotLike } from "../util.ts";
import type { ButtonInput } from "../types.ts";
import { addPostMessage, createPost, logActivity } from "../store.ts";
import { postKeyboard } from "../keyboards.ts";

/**
 * Publishes one piece of content to every chosen destination, remembering
 * exactly which Telegram message each copy became so its buttons can be
 * updated later (spec section 14, "Changing a Button Later").
 */
export async function publishPost(
  bot: BotLike,
  opts: { label: string; text: string; buttons: ButtonInput[]; destinations: string[]; actor: string },
) {
  const post = await createPost(opts.label, opts.text, opts.buttons);
  const reply_markup = opts.buttons.length ? postKeyboard(opts.buttons) : undefined;

  let sent = 0;
  const failed: string[] = [];
  for (const chatId of opts.destinations) {
    try {
      const msg = await bot.api.sendMessage({ chat_id: chatId, text: opts.text, reply_markup });
      await addPostMessage(post.id, chatId, msg.message_id);
      sent++;
    } catch (err) {
      console.error(`publish to ${chatId} failed`, err);
      failed.push(chatId);
    }
  }

  await logActivity({
    actor: opts.actor,
    area: "Content",
    action: "publish",
    detail: `post ${post.id} -> ${sent} ok, ${failed.length} failed`,
  });
  return { post, sent, failed };
}
